// 定期备份到对象存储桶（S3 兼容协议）
//
// 为什么要 S3 协议：七牛 Kodo / 阿里云 OSS / 腾讯云 COS / Cloudflare R2 / MinIO / Backblaze B2
// 都提供 S3 兼容端点，一套 AWS Signature V4 就能全部打通，不用为每家写一套 SDK。
// 七牛的 S3 兼容域名叫 s3.{region}.qiniucs.com（如 s3.cn-east-1.qiniucs.com），
// 只支持 path-style，签名与 AWS 一致，且必须带 x-amz-content-sha256。
//
// 配置单独存在 app_setting 的 backup_s3 键里（和 WebDAV 同样的理由：
// SecretKey 绝不能进导出的 JSON 备份），SecretKey 落库前用 SECRET 派生的 AES-GCM 加密。
//
// 触发方式与 WebDAV 版一致：
//   1) Cron Trigger（每小时一轮，由 freq/hour/weekday 决定这一轮跑不跑）
//   2) 后台「立即备份」按钮

import { json, bad, readJson } from '../lib/http';
import { requireRole, applySnapshot } from './admin';
import { getSecret } from '../lib/secret';
import { buildSnapshot, stamp, encryptSecret, decryptSecret, type RunResult } from './webdav';
import type { Env } from '../lib/schema';

export interface S3Cfg {
  enabled: boolean;
  endpoint: string;   // 例如 https://s3.cn-east-1.qiniucs.com（不带 bucket）
  region: string;     // 例如 cn-east-1；R2 填 auto
  bucket: string;     // 空间名 / 桶名
  ak: string;
  sk: string;
  prefix: string;     // 存到桶里的目录前缀，例如 udenav-backup
  keep: number;       // 保留最近几份
  freq: 'hourly' | 'daily' | 'weekly';
  hour: number;
  weekday: number;
  last_at?: number;
  last_ok?: boolean;
  last_msg?: string;
}

const KEY = 'backup_s3';
const DEFAULT_CFG: S3Cfg = {
  enabled: false, endpoint: '', region: '', bucket: '', ak: '', sk: '',
  prefix: 'udenav-backup', keep: 7, freq: 'daily', hour: 3, weekday: 1,
};

function normFreq(v: unknown, fallback: S3Cfg['freq']): S3Cfg['freq'] {
  return v === 'hourly' || v === 'daily' || v === 'weekly' ? v : fallback;
}

/* ---------------- 配置读写 ---------------- */

async function loadCfg(env: Env): Promise<S3Cfg> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(KEY).first<{ value: string }>();
  if (!row?.value) return { ...DEFAULT_CFG };
  try {
    const cfg = { ...DEFAULT_CFG, ...JSON.parse(row.value) } as S3Cfg;
    if (cfg.sk) cfg.sk = await decryptSecret(cfg.sk, await getSecret(env));
    return cfg;
  } catch {
    return { ...DEFAULT_CFG };
  }
}

async function saveCfg(env: Env, cfg: S3Cfg): Promise<void> {
  const secret = await getSecret(env);
  const stored: S3Cfg = { ...cfg, sk: await encryptSecret(cfg.sk, secret) };
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(KEY, JSON.stringify(stored), Date.now())
    .run();
}

/** 这一轮 Cron 是否该真正执行（北京时间判断小时/星期，和 WebDAV 版同口径） */
function dueNow(cfg: S3Cfg): boolean {
  if (!cfg.enabled || !cfg.endpoint || !cfg.bucket) return false;
  if (cfg.freq === 'hourly') return true;
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  if (now.getUTCHours() !== cfg.hour) return false;
  if (cfg.freq === 'weekly') return now.getUTCDay() === cfg.weekday;
  return true;
}

export function describeS3Freq(cfg: S3Cfg): string {
  const hh = String(cfg.hour).padStart(2, '0') + ':00';
  if (cfg.freq === 'hourly') return '每小时整点';
  if (cfg.freq === 'weekly') return `每周${'日一二三四五六'[cfg.weekday]} ${hh}`;
  return `每天 ${hh}`;
}

/* ---------------- AWS Signature V4 ---------------- */

const enc = new TextEncoder();

function hex(buf: Uint8Array): string {
  let s = '';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf = typeof data === 'string' ? enc.encode(data) : data;
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)));
}

async function hmac(key: Uint8Array | string, msg: string): Promise<Uint8Array> {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

async function signingKey(sk: string, date: string, region: string): Promise<Uint8Array> {
  let k = await hmac('AWS4' + sk, date);
  k = await hmac(k, region);
  k = await hmac(k, 's3');
  return hmac(k, 'aws4_request');
}

/** 逐段编码，保留 '/' —— 与最终请求 URL 的 path 必须逐字节一致，否则签名对不上 */
function encodeKey(key: string): string {
  return key.split('/').map((s) => encodeURIComponent(s)).join('/');
}

interface ReqOpts { body?: Uint8Array | string; contentType?: string; query?: Record<string, string> }

/**
 * 发一个已签名的 S3 请求。path-style：/{bucket}/{key}，七牛只支持这种风格。
 * 说明：host 头不能手动设置（Workers 禁止），但签名里要算它 —— runtime 会自动补上同名同值的头，能对上。
 */
async function s3Request(cfg: S3Cfg, method: string, key: string, opts: ReqOpts = {}): Promise<Response> {
  const base = cfg.endpoint.replace(/\/+$/, '');
  const path = key ? `/${encodeKey(cfg.bucket)}/${encodeKey(key)}` : `/${encodeKey(cfg.bucket)}`;
  const qs = opts.query
    ? Object.keys(opts.query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(opts.query![k])}`).join('&')
    : '';
  const url = `${base}${path}${qs ? '?' + qs : ''}`;
  const host = new URL(url).host;

  const payload = opts.body === undefined
    ? new Uint8Array(0)
    : typeof opts.body === 'string' ? enc.encode(opts.body) : opts.body;
  const payloadHash = await sha256Hex(payload);

  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [method, path, qs, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = hex(await hmac(await signingKey(cfg.sk, dateStamp, cfg.region), stringToSign));

  const headers: Record<string, string> = {
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${cfg.ak}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (opts.contentType) headers['content-type'] = opts.contentType;

  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'DELETE' && payload.length) init.body = payload as unknown as BodyInit;
  return fetch(url, init);
}

/* ---------------- 对象操作 ---------------- */

function xmlDecode(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export interface S3File { name: string; size: number; mtime: number }

/** ListObjectsV2：只取我们自己的 udenav-*.json（前缀下的其它东西一概不碰） */
async function listRemote(cfg: S3Cfg): Promise<S3File[]> {
  const prefix = cfg.prefix.replace(/^\/+|\/+$/g, '');
  const r = await s3Request(cfg, 'GET', '', {
    query: { 'list-type': '2', 'max-keys': '1000', ...(prefix ? { prefix: prefix + '/' } : {}) },
  });
  if (r.status === 403) throw new Error('访问被拒绝（403）：AccessKey / SecretKey 不对，或没有该桶的读写权限');
  if (r.status === 404) throw new Error('桶不存在（404）：检查桶名和区域 endpoint 是否对应');
  if (!r.ok) throw new Error(`读取桶内文件失败：HTTP ${r.status} ${await errDetail(r)}`);

  const xml = await r.text();
  const out: S3File[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1] || '';
    const name = xmlDecode(key).split('/').pop() || '';
    if (!/^udenav-.*\.json$/i.test(name)) continue;
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] || 0);
    const lm = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(block)?.[1] || '';
    const t = Date.parse(lm);
    out.push({ name, size, mtime: Number.isFinite(t) ? t : 0 });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** S3 的错误体是 XML，正文里的 <Message> 比 HTTP 状态码有用得多 */
async function errDetail(r: Response): Promise<string> {
  try {
    const t = await r.text();
    const code = /<Code>([\s\S]*?)<\/Code>/.exec(t)?.[1] || '';
    const msg = /<Message>([\s\S]*?)<\/Message>/.exec(t)?.[1] || '';
    return [code, msg].filter(Boolean).join('：') || t.slice(0, 200);
  } catch {
    return '';
  }
}

function keyOf(cfg: S3Cfg, file: string): string {
  const prefix = cfg.prefix.replace(/^\/+|\/+$/g, '');
  return prefix ? `${prefix}/${file}` : file;
}

/** 清理超出保留份数的旧备份（按文件名倒序 = 按时间倒序，保留最新的 keep 份） */
async function pruneOld(cfg: S3Cfg, keep: number): Promise<number> {
  if (keep <= 0) return 0;
  const files = await listRemote(cfg);
  const stale = files.slice(keep);
  let deleted = 0;
  for (const f of stale) {
    const r = await s3Request(cfg, 'DELETE', keyOf(cfg, f.name));
    if (r.ok || r.status === 404) deleted++;
  }
  return deleted;
}

/* ---------------- 备份 / 恢复 ---------------- */

export async function runS3Backup(env: Env, cfg: S3Cfg): Promise<RunResult> {
  const file = `udenav-${stamp()}.json`;
  if (!cfg.endpoint) return { ok: false, file, message: '未配置 Endpoint' };
  if (!cfg.region) return { ok: false, file, message: '未配置 Region' };
  if (!cfg.bucket) return { ok: false, file, message: '未配置桶名' };
  if (!cfg.ak || !cfg.sk) return { ok: false, file, message: '未配置 AccessKey / SecretKey' };

  const snapshot = await buildSnapshot(env);
  const body = JSON.stringify(snapshot);

  let put: Response;
  try {
    put = await s3Request(cfg, 'PUT', keyOf(cfg, file), { body, contentType: 'application/json; charset=utf-8' });
  } catch (e: any) {
    return { ok: false, file, message: '连不上对象存储：' + (e?.message || '网络错误') };
  }

  if (!put.ok) {
    const detail = await errDetail(put);
    const tip = put.status === 403 ? 'AccessKey / SecretKey 不对，或没有写入权限'
      : put.status === 404 ? '桶不存在：检查桶名与 endpoint 区域是否对应'
      : put.status === 400 ? '请求被拒绝：Region 与 endpoint 不匹配？'
      : `HTTP ${put.status}`;
    return { ok: false, file, message: `上传失败：${tip}${detail ? '（' + detail + '）' : ''}` };
  }

  let pruned = 0;
  try { pruned = await pruneOld(cfg, cfg.keep); } catch { /* 清理失败不影响本次备份 */ }
  return { ok: true, file, message: `已上传到 ${cfg.bucket}`, pruned };
}

export async function runS3BackupNow(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const old = await loadCfg(env);
  const cfg: S3Cfg = {
    ...old,
    endpoint: String(body.endpoint ?? old.endpoint).trim() || old.endpoint,
    region: String(body.region ?? old.region).trim() || old.region,
    bucket: String(body.bucket ?? old.bucket).trim() || old.bucket,
    ak: String(body.ak ?? old.ak).trim() || old.ak,
    sk: String(body.sk ?? '') || old.sk,
    prefix: String(body.prefix ?? old.prefix).trim(),
    keep: Math.max(1, Math.min(60, Math.floor(Number(body.keep ?? old.keep) || 7))),
    freq: normFreq(body.freq, old.freq),
    hour: Math.max(0, Math.min(23, Math.floor(Number(body.hour ?? old.hour) || 0))),
    weekday: Math.max(0, Math.min(6, Math.floor(Number(body.weekday ?? old.weekday) || 0))),
  };
  const res = await runS3Backup(env, cfg);
  await saveCfg(env, { ...cfg, last_at: Date.now(), last_ok: res.ok, last_msg: res.message + (res.file ? `（${res.file}）` : '') });
  return json({ ok: res.ok, message: res.message, file: res.file, pruned: res.pruned ?? 0 }, { status: res.ok ? 200 : 500 });
}

/* ---------------- HTTP 接口 ---------------- */

export async function getS3Cfg(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const cfg = await loadCfg(env);
  const { sk, ...rest } = cfg;
  return json({ ok: true, cfg: { ...rest, has_sk: !!sk } });
}

export async function putS3Cfg(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const old = await loadCfg(env);
  const endpoint = String(body.endpoint ?? old.endpoint).trim();
  if (endpoint && !/^https?:\/\//i.test(endpoint)) return bad('Endpoint 要以 http:// 或 https:// 开头');
  const cfg: S3Cfg = {
    enabled: !!body.enabled,
    endpoint,
    region: String(body.region ?? old.region).trim(),
    bucket: String(body.bucket ?? old.bucket).trim(),
    ak: String(body.ak ?? old.ak).trim(),
    sk: String(body.sk ?? '') || old.sk,
    prefix: String(body.prefix ?? old.prefix).trim(),
    keep: Math.max(1, Math.min(60, Math.floor(Number(body.keep ?? old.keep) || 7))),
    freq: normFreq(body.freq, old.freq),
    hour: Math.max(0, Math.min(23, Math.floor(Number(body.hour ?? old.hour) || 0))),
    weekday: Math.max(0, Math.min(6, Math.floor(Number(body.weekday ?? old.weekday) || 0))),
    last_at: old.last_at,
    last_ok: old.last_ok,
    last_msg: old.last_msg,
  };
  await saveCfg(env, cfg);
  return json({ ok: true });
}

/** 测试连接：只做一次只读的 ListObjectsV2，不往桶里写任何东西 */
export async function testS3Conn(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const old = await loadCfg(env);
  const cfg: S3Cfg = {
    ...old,
    endpoint: String(body.endpoint ?? old.endpoint).trim(),
    region: String(body.region ?? old.region).trim(),
    bucket: String(body.bucket ?? old.bucket).trim(),
    ak: String(body.ak ?? old.ak).trim(),
    sk: String(body.sk ?? '') || old.sk,
    prefix: String(body.prefix ?? old.prefix).trim(),
  };
  if (!cfg.endpoint) return json({ ok: false, message: '先填 Endpoint 再测试' });
  if (!cfg.region) return json({ ok: false, message: '先填 Region（七牛如 cn-east-1，R2 填 auto）' });
  if (!cfg.bucket) return json({ ok: false, message: '先填桶名再测试' });
  if (!cfg.ak || !cfg.sk) return json({ ok: false, message: '先填 AccessKey 和 SecretKey 再测试' });

  try {
    const files = await listRemote(cfg);
    const prefix = cfg.prefix.replace(/^\/+|\/+$/g, '') || '（根目录）';
    return json({
      ok: true,
      message: `连接成功：桶「${cfg.bucket}」可读写，目录「${prefix}」下已有 ${files.length} 份备份`,
    });
  } catch (e: any) {
    return json({ ok: false, message: e?.message || '连接失败' });
  }
}

export async function listS3Backups(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const cfg = await loadCfg(env);
  if (!cfg.endpoint || !cfg.bucket || !cfg.ak || !cfg.sk) return bad('还没有配置对象存储');
  try {
    return json({ ok: true, dir: cfg.prefix || '（根目录）', files: await listRemote(cfg) });
  } catch (e: any) {
    return bad(e?.message || '读取桶内备份列表失败');
  }
}

export async function restoreS3Backup(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const body = await readJson(req) as any;
  const cfg = await loadCfg(env);
  if (!cfg.endpoint || !cfg.bucket || !cfg.ak || !cfg.sk) return bad('还没有配置对象存储');

  let file = String(body.file || '').trim();
  if (!file) {
    try {
      const files = await listRemote(cfg);
      if (!files.length) return bad('桶里还没有备份文件，先点一次「立即备份」');
      file = files[0].name;
    } catch (e: any) {
      return bad(e?.message || '读取桶内备份列表失败');
    }
  }
  if (!/^udenav-.*\.json$/i.test(file)) return bad('备份文件名不合法');

  const r = await s3Request(cfg, 'GET', keyOf(cfg, file));
  if (r.status === 404) return bad(`桶里找不到 ${file}`);
  if (!r.ok) return bad(`下载备份失败：HTTP ${r.status} ${await errDetail(r)}`);

  let snap: any;
  try {
    snap = JSON.parse((await r.text()).replace(/^\uFEFF/, ''));
  } catch {
    return bad('备份文件不是有效的 JSON，可能上传时被截断了');
  }
  if (!snap || snap.app !== 'udenav' || !Array.isArray(snap.groups)) return bad('这不是本系统导出的备份文件');

  const meta = {
    file,
    exported_at: Number(snap.exported_at || 0),
    groups: snap.groups.length,
    icons: Array.isArray(snap.icons) ? snap.icons.length : 0,
    configs: Array.isArray(snap.config) ? snap.config.length : 0,
  };
  if (body.dry) return json({ ok: true, dry: true, ...meta });

  try {
    await applySnapshot(env, snap, s.sub);
  } catch (e: any) {
    return bad('恢复失败：' + (e?.message || '未知错误'));
  }
  return json({ ok: true, ...meta });
}

/** Cron 入口：和 WebDAV 版并行，谁启用跑谁，互不影响 */
export async function scheduledS3Backup(env: Env): Promise<void> {
  const cfg = await loadCfg(env);
  if (!dueNow(cfg)) return;
  const res = await runS3Backup(env, cfg);
  await saveCfg(env, { ...cfg, last_at: Date.now(), last_ok: res.ok, last_msg: res.message + (res.file ? `（${res.file}）` : '') });
}
