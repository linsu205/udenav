// 定期备份到 WebDAV（坚果云 / 群晖 / Nextcloud 等）
//
// 为什么要单独一张 app_setting 表存配置：WebDAV 账号密码不能进导出的 JSON 备份，
// 否则备份文件本身就成了凭据泄露源。user_config 会被导入导出整表覆盖，也不适合。
//
// 触发方式：
//   1) Cron Trigger（wrangler.toml 里每天 19:00 UTC = 次日 03:00 北京时间）→ scheduled()
//   2) 后台「立即备份」按钮 → runBackupNow()

import { json, bad, readJson } from '../lib/http';
import { requireRole, applySnapshot } from './admin';
import type { Env, ConfigRow, GroupRow, IconRow } from '../lib/schema';

export interface BackupCfg {
  enabled: boolean;
  url: string;      // 例如 https://dav.jianguoyun.com/dav/
  user: string;
  pass: string;     // 坚果云要用「应用密码」，不是登录密码
  dir: string;      // 备份目录，例如 udenav-backup
  keep: number;     // 保留最近几份
  /* 执行策略：Cron 实际是每小时触发一次（部署配置不能运行时改），
     由这里决定「这一轮要不要真的跑」 */
  freq: 'hourly' | 'daily' | 'weekly';
  hour: number;     // 0-23，北京时间，daily/weekly 用
  weekday: number;  // 0-6（0=周日），weekly 用
  last_at?: number;
  last_ok?: boolean;
  last_msg?: string;
}

const KEY = 'backup_webdav';
const DEFAULT_CFG: BackupCfg = {
  enabled: false, url: '', user: '', pass: '', dir: 'udenav-backup', keep: 7,
  freq: 'daily', hour: 3, weekday: 1,
};

function normFreq(v: unknown, fallback: BackupCfg['freq']): BackupCfg['freq'] {
  return v === 'hourly' || v === 'daily' || v === 'weekly' ? v : fallback;
}

/** 这一轮 Cron 是否该真正执行（按北京时间判断小时/星期） */
function dueNow(cfg: BackupCfg): boolean {
  if (!cfg.enabled || !cfg.url) return false;
  if (cfg.freq === 'hourly') return true;
  const now = new Date(Date.now() + 8 * 3600 * 1000);   // 平移到北京时间后读 UTC 字段
  if (now.getUTCHours() !== cfg.hour) return false;
  if (cfg.freq === 'weekly') return now.getUTCDay() === cfg.weekday;
  return true;
}

/** 人类可读的策略描述，写进状态里方便面板核对 */
export function describeFreq(cfg: BackupCfg): string {
  const hh = String(cfg.hour).padStart(2, '0') + ':00';
  if (cfg.freq === 'hourly') return '每小时整点';
  if (cfg.freq === 'weekly') return `每周${'日一二三四五六'[cfg.weekday]} ${hh}`;
  return `每天 ${hh}`;
}

/* ---------------- 配置读写 ---------------- */

async function loadCfg(env: Env): Promise<BackupCfg> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(KEY).first<{ value: string }>();
  if (!row?.value) return { ...DEFAULT_CFG };
  try {
    return { ...DEFAULT_CFG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_CFG };
  }
}

async function saveCfg(env: Env, cfg: BackupCfg): Promise<void> {
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(KEY, JSON.stringify(cfg), Date.now())
    .run();
}

/* ---------------- WebDAV 基础操作 ---------------- */

/** Basic 认证头：btoa 只接受 latin1，中文/特殊字符密码要先按 UTF-8 取字节 */
function basicAuth(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return 'Basic ' + btoa(bin);
}

function joinUrl(base: string, ...parts: string[]): string {
  const head = base.replace(/\/+$/, '');
  const tail = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
  return tail ? `${head}/${tail}` : head;
}

/** 确保目录存在：已存在返回 405，创建成功返回 201，都算通过 */
async function ensureDir(dirUrl: string, auth: string): Promise<void> {
  const r = await fetch(dirUrl, { method: 'MKCOL', headers: { authorization: auth } });
  if (r.status === 201 || r.status === 405 || r.status === 200) return;
  /* 409 = 上级目录不存在，交给 PUT 时报出更具体的错误 */
}

/** 列表 + 清理超出保留份数的旧文件（PROPFIND 只解析 href，够用） */
async function pruneOld(dirUrl: string, auth: string, keep: number): Promise<number> {
  if (keep <= 0) return 0;
  const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/></d:prop></d:propfind>';
  const r = await fetch(dirUrl, {
    method: 'PROPFIND',
    headers: { authorization: auth, depth: '1', 'content-type': 'application/xml; charset=utf-8' },
    body,
  });
  if (!r.ok) return 0;
  const xml = await r.text();
  const names = [...xml.matchAll(/<[^>]*href[^>]*>\s*([^<]+?)\s*</gi)]
    .map((m) => {
      const raw = m[1];
      const seg = raw.split('/').filter(Boolean).pop() || '';
      try { return decodeURIComponent(seg); } catch { return seg; }
    })
    .filter((n) => /^udenav-.*\.json$/i.test(n))
    .sort()
    .reverse();
  const stale = names.slice(keep);
  let deleted = 0;
  for (const n of stale) {
    const res = await fetch(joinUrl(dirUrl, n), { method: 'DELETE', headers: { authorization: auth } });
    if (res.ok || res.status === 404) deleted++;
  }
  return deleted;
}

/* ---------------- 快照 ---------------- */

/** 与 /api/admin/export 同口径，但不需要 session（cron 里没有登录态） */
async function buildSnapshot(env: Env) {
  const [g, i, c, u] = await Promise.all([
    env.DB.prepare('SELECT * FROM item_icon_group ORDER BY sort, id').all<GroupRow>(),
    env.DB.prepare('SELECT * FROM item_icon ORDER BY group_id, sort, id').all<IconRow>(),
    env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>(),
    env.DB.prepare('SELECT id, username, display_name, role, created_at FROM users').all(),
  ]);
  const safeParse = (v: string) => { try { return JSON.parse(v); } catch { return v; } };
  return {
    ok: true,
    app: 'udenav',
    exported_at: Date.now(),
    source: 'webdav-auto',
    config: c.results.map((r) => ({ key: r.key, value: safeParse(r.value) })),
    users: u.results.map((r) => ({ ...r, password: '<请用 JSON 导入界面单独设置>' })),
    groups: g.results,
    icons: i.results,
  };
}

function stamp(d = new Date()): string {
  /* 文件名按北京时间，和面板上显示的时间一致，便于人工核对 */
  const t = new Date(d.getTime() + 8 * 3600 * 1000).toISOString();
  return t.slice(0, 10).replace(/-/g, '') + '-' + t.slice(11, 16).replace(':', '');
}

export interface RunResult { ok: boolean; file: string; message: string; pruned?: number }

/** 真正跑一次备份：快照 → 建目录 → PUT → 清理旧份数 */
export async function runBackup(env: Env, cfg: BackupCfg): Promise<RunResult> {
  const file = `udenav-${stamp()}.json`;
  if (!cfg.url) return { ok: false, file, message: '未配置 WebDAV 地址' };
  if (!cfg.user || !cfg.pass) return { ok: false, file, message: '未配置 WebDAV 账号或密码' };

  const auth = basicAuth(cfg.user, cfg.pass);
  const dirUrl = joinUrl(cfg.url, cfg.dir || '');

  await ensureDir(dirUrl, auth);

  const snapshot = await buildSnapshot(env);
  const put = await fetch(joinUrl(dirUrl, file), {
    method: 'PUT',
    headers: { authorization: auth, 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(snapshot),
  });

  if (!put.ok) {
    const tip = put.status === 401 ? '账号或密码不对（坚果云要用「应用密码」）'
      : put.status === 403 ? '没有写入权限'
      : put.status === 404 ? '目录不存在且无法创建，检查地址是否以 /dav/ 结尾'
      : put.status === 409 ? '上级目录不存在，检查备份目录名'
      : `HTTP ${put.status}`;
    return { ok: false, file, message: `上传失败：${tip}` };
  }

  let pruned = 0;
  try { pruned = await pruneOld(dirUrl, auth, cfg.keep); } catch { /* 清理失败不影响本次备份 */ }
  return { ok: true, file, message: '备份成功', pruned };
}

/* ---------------- HTTP 接口 ---------------- */

/** GET /api/admin/backup —— 读配置（不返回密码，只告知是否已设置） */
export async function getBackupCfg(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const cfg = await loadCfg(env);
  const { pass, ...rest } = cfg;
  return json({ ok: true, cfg: { ...rest, has_pass: !!pass } });
}

/** PUT /api/admin/backup —— 保存配置（pass 留空 = 沿用已存的密码） */
export async function putBackupCfg(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const old = await loadCfg(env);
  const url = String(body.url ?? old.url).trim();
  if (url && !/^https?:\/\//i.test(url)) return bad('WebDAV 地址要以 http:// 或 https:// 开头');
  const cfg: BackupCfg = {
    enabled: !!body.enabled,
    url,
    user: String(body.user ?? old.user).trim(),
    pass: String(body.pass ?? '') || old.pass,
    dir: String(body.dir ?? old.dir).trim() || 'udenav-backup',
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

/** POST /api/admin/backup —— 立即备份（可用请求体里的表单值临时覆盖，便于存前先试） */
export async function runBackupNow(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const old = await loadCfg(env);
  const cfg: BackupCfg = {
    ...old,
    url: String(body.url ?? old.url).trim() || old.url,
    user: String(body.user ?? old.user).trim() || old.user,
    pass: String(body.pass ?? '') || old.pass,
    dir: String(body.dir ?? old.dir).trim() || old.dir,
    keep: Math.max(1, Math.min(60, Math.floor(Number(body.keep ?? old.keep) || 7))),
    /* 表单里改了策略但还没点保存就点「立即备份」时，别把旧策略又写回去 */
    freq: normFreq(body.freq, old.freq),
    hour: Math.max(0, Math.min(23, Math.floor(Number(body.hour ?? old.hour) || 0))),
    weekday: Math.max(0, Math.min(6, Math.floor(Number(body.weekday ?? old.weekday) || 0))),
  };
  const res = await runBackup(env, cfg);
  /* 把结果写回配置，面板上直接显示「上次备份」状态 */
  const saved: BackupCfg = { ...cfg, last_at: Date.now(), last_ok: res.ok, last_msg: res.message + (res.file ? `（${res.file}）` : '') };
  await saveCfg(env, saved);
  return json({ ok: res.ok, message: res.message, file: res.file, pruned: res.pruned ?? 0 }, { status: res.ok ? 200 : 500 });
}

/** Cron 入口：只在启用时跑，失败也把状态写回去，方便下次打开面板看到原因 */
export async function scheduledBackup(env: Env): Promise<void> {
  const cfg = await loadCfg(env);
  /* Cron 每小时触发一次，具体跑不跑由 freq/hour/weekday 决定 */
  if (!dueNow(cfg)) return;
  const res = await runBackup(env, cfg);
  await saveCfg(env, { ...cfg, last_at: Date.now(), last_ok: res.ok, last_msg: res.message + (res.file ? `（${res.file}）` : '') });
}

/* ---------------- 从云端恢复 ---------------- */

export interface BackupFile { name: string; size: number; mtime: number }

/** 解析 PROPFIND 应答：按 <response> 切块逐个取 href / 大小 / 修改时间。
    WebDAV 服务端的命名空间前缀大小写不一（d: / D: / lp1:），所以只认标签尾部的名字。 */
function parsePropfind(xml: string): BackupFile[] {
  const out: BackupFile[] = [];
  for (const block of xml.split(/<\/[A-Za-z0-9]*:?response>/i)) {
    const href = block.match(/<[A-Za-z0-9]*:?href>\s*([^<]+?)\s*</i);
    if (!href) continue;
    const seg = href[1].split('/').filter(Boolean).pop() || '';
    let name = seg;
    try { name = decodeURIComponent(seg); } catch { /* 保留原样 */ }
    if (!/^udenav-.*\.json$/i.test(name)) continue;
    const size = Number((block.match(/<[A-Za-z0-9]*:?getcontentlength>\s*(\d+)/i) || [])[1] || 0);
    const lm = (block.match(/<[A-Za-z0-9]*:?getlastmodified>\s*([^<]+?)\s*</i) || [])[1] || '';
    const t = Date.parse(lm);
    out.push({ name, size, mtime: Number.isFinite(t) ? t : 0 });
  }
  /* 文件名是 udenav-YYYYMMDD-HHMM.json，字典序即时间序，倒序排就是最新在前 */
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** 读出备份目录里的文件清单；顺手用 PROPFIND 的改时间给面板显示 */
async function listRemoteFiles(cfg: BackupCfg): Promise<BackupFile[]> {
  const auth = basicAuth(cfg.user, cfg.pass);
  const dirUrl = joinUrl(cfg.url, cfg.dir || '');
  const body = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>';
  const r = await fetch(dirUrl, {
    method: 'PROPFIND',
    headers: { authorization: auth, depth: '1', 'content-type': 'application/xml; charset=utf-8' },
    body,
  });
  if (r.status === 401) throw new Error('WebDAV 账号或密码不对（坚果云要用「应用密码」）');
  if (r.status === 404) throw new Error('备份目录不存在，先点一次「立即备份」');
  if (!r.ok) throw new Error(`读取备份目录失败：HTTP ${r.status}`);
  return parsePropfind(await r.text());
}

function requireDav(cfg: BackupCfg): string | null {
  if (!cfg.url) return '还没有配置 WebDAV 地址';
  if (!cfg.user || !cfg.pass) return '还没有配置 WebDAV 账号或密码';
  return null;
}

/** GET /api/admin/backup/list —— 列出云端有哪些备份（最新在前） */
export async function listBackups(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const cfg = await loadCfg(env);
  const miss = requireDav(cfg);
  if (miss) return bad(miss);
  try {
    const files = await listRemoteFiles(cfg);
    return json({ ok: true, dir: cfg.dir, files });
  } catch (e: any) {
    return bad(e?.message || '读取云端备份列表失败');
  }
}

/** POST /api/admin/backup/restore —— 从云端恢复一份备份（不传 file 就取最新）
    body.dry = true 时只下载并回报这份备份里有什么，不写库——面板用它先给用户确认。 */
export async function restoreBackup(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const body = await readJson(req) as any;
  const cfg = await loadCfg(env);
  const miss = requireDav(cfg);
  if (miss) return bad(miss);

  const auth = basicAuth(cfg.user, cfg.pass);
  const dirUrl = joinUrl(cfg.url, cfg.dir || '');
  const want = String(body.file || '').trim();

  let file = want;
  if (!file) {
    try {
      const files = await listRemoteFiles(cfg);
      if (!files.length) return bad('云端还没有备份文件，先点一次「立即备份」');
      file = files[0].name;      // 文件名带时间戳且已倒序，第一条就是最新
    } catch (e: any) {
      return bad(e?.message || '读取云端备份列表失败');
    }
  }
  if (!/^udenav-.*\.json$/i.test(file)) return bad('备份文件名不合法');

  const r = await fetch(joinUrl(dirUrl, file), { headers: { authorization: auth } });
  if (r.status === 404) return bad(`云端找不到 ${file}`);
  if (!r.ok) return bad(`下载备份失败：HTTP ${r.status}`);

  let snap: any;
  try {
    snap = JSON.parse((await r.text()).replace(/^\uFEFF/, ''));
  } catch {
    return bad('备份文件不是有效的 JSON，可能上传时被截断了');
  }
  if (!snap || snap.app !== 'udenav' || !Array.isArray(snap.groups)) {
    return bad('这不是本系统导出的备份文件');
  }

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
