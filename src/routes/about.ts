// 「关于」页数据：版本 / 运行环境 / 项目情况
//
// 为什么这些信息不写死在前端：
//   1. 数据模型版本、功能开关（WebDAV / Cron / Access / CORS / 密钥来源）只有 Worker 知道；
//   2. 前端是构建产物，版本号打进包里就固化了，接口返回才能反映「线上真正在跑什么」；
//   3. 检查更新要请求 GitHub，浏览器直连会被 CORS 挡，也不该把「比版本」的逻辑放前端。

import { json } from '../lib/http';
import { requireRole } from './admin';
import { describeFreq, type BackupCfg } from './webdav';
import { SCHEMA_VERSION, type Env } from '../lib/schema';
import { APP_NAME, APP_VERSION, APP_REPO, REPO_SLUG, COMPAT_DATE } from '../lib/version';

const BACKUP_KEY = 'backup_webdav';

/** 浏览器插件仓库（和主仓库分开，发布节奏也不同） */
const EXT_REPO_SLUG = 'linsu205/udenav-extension';
const EXT_REPO = 'https://github.com/' + EXT_REPO_SLUG;

/* GitHub 接口有未认证限速（60 次/小时/IP），Worker 出口 IP 是共享的，
   所以结果在实例内存里缓存 10 分钟；实例回收了也只是重新查一次。 */
const GH_TIMEOUT = 6000;
const GH_CACHE_MS = 10 * 60 * 1000;
let ghCache: { at: number; data: LatestInfo } | null = null;

type LatestInfo =
  | { ok: true; kind: 'release' | 'commit'; version: string; name: string; date: string; url: string; sha: string; message: string }
  | { ok: false; error: string };

/** GET /api/admin/about —— 「关于」页的主体数据 */
export async function aboutInfo(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');

  /* 只用 COUNT，不扫长文本列：D1 按行计费，这个接口会被反复打开，
     真正的字节占用看「访问统计」页就够了 */
  const [g, i, u, v, schemaRow, backupRow] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon_group').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log').first<{ n: number }>(),
    env.DB.prepare('SELECT value FROM schema_meta WHERE key = ?').bind('version').first<{ value: string }>(),
    env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(BACKUP_KEY).first<{ value: string }>(),
  ]);

  const dbSchema = schemaRow?.value || '';
  let backup: Record<string, unknown> = { enabled: false, configured: false };
  if (backupRow?.value) {
    try {
      const cfg = JSON.parse(backupRow.value) as BackupCfg;
      backup = {
        enabled: !!cfg.enabled,
        configured: !!cfg.url,
        freq: describeFreq(cfg),
        last_at: cfg.last_at ?? null,
        last_ok: cfg.last_ok ?? null,
        last_msg: cfg.last_msg ?? '',
        keep: cfg.keep ?? 7,
      };
    } catch {
      /* 配置坏了不该让整页 500，按未配置处理 */
    }
  }

  /* 部署版本元数据：只有控制台额外加了 version_metadata 绑定才拿得到，
     没配就返回 null，前端显示「未开启」而不是报错 */
  const meta = (env as Env & { CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string } }).CF_VERSION_METADATA;

  return json({
    ok: true,
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      repo: APP_REPO,
      repo_slug: REPO_SLUG,
      compat_date: COMPAT_DATE,
    },
    schema: {
      code: SCHEMA_VERSION,
      db: dbSchema,
      /* 代码期望的版本和库里记录的不一致 → 说明迁移没跑完，前端标黄 */
      matched: !!dbSchema && dbSchema === SCHEMA_VERSION,
    },
    runtime: {
      now: Date.now(),
      deploy_id: meta?.id || '',
      deploy_tag: meta?.tag || '',
      deploy_at: meta?.timestamp || '',
      features: {
        /* Secret 来源：环境变量配了就直接用，否则是自动生成后存在 D1 */
        secret_from_env: !!(env.SECRET && env.SECRET.length >= 16),
        access: !!env.ACCESS_AUD,
        cors: !!env.CORS_ORIGIN,
        seed_demo: env.SEED_DEMO === '1',
        cron: true,
      },
    },
    data: {
      groups: Number(g?.n ?? 0),
      icons: Number(i?.n ?? 0),
      users: Number(u?.n ?? 0),
      visits: Number(v?.n ?? 0),
    },
    backup,
  });
}

/** GET /api/admin/about/check —— 查上游仓库最新发布 / 提交 */
export async function checkLatest(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');

  const now = Date.now();
  if (ghCache && now - ghCache.at < GH_CACHE_MS) {
    return json({ ...ghCache.data, local: localMeta(), cached: true, cached_at: ghCache.at });
  }

  const data = await fetchLatest();
  if (data.ok) ghCache = { at: now, data };
  return json({ ...data, local: localMeta(), cached: false, cached_at: now });
}

function localMeta() {
  return { version: APP_VERSION, compat_date: COMPAT_DATE, repo: APP_REPO, repo_slug: REPO_SLUG };
}

/* ---------------- 浏览器插件 ---------------- */

let extCache: { at: number; data: ExtInfo } | null = null;
const EXT_CACHE_MS = 10 * 60 * 1000;

type ExtAsset = { name: string; size: number; url: string };
/* 不带 ok 字段：外层的 json({ ok: true, ...data }) 已经表过态，
   两处都写同一个键会被 spread 覆盖（tsc 也会报 TS2783） */
type ExtInfo = {
  latest: { version: string; date: string; url: string; notes: string; assets: ExtAsset[] } | null;
  error?: string;
};

/**
 * GET /api/admin/extension —— 「浏览器插件」页的数据源
 *
 * 只查 release（插件是压缩包分发，没有「只有提交」的分支）：
 * 拿不到就返回 latest:null + 一句人话，前端退化成「去 Releases 页自己下」，
 * 不让整页报错 —— 用户来这页的目的就是「给我一个能点的下载链接」。
 */
export async function extensionInfo(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');

  const now = Date.now();
  if (extCache && now - extCache.at < EXT_CACHE_MS) {
    return json({ ok: true, repo: EXT_REPO, repo_slug: EXT_REPO_SLUG, releases: EXT_REPO + '/releases', ...extCache.data, cached: true, cached_at: extCache.at });
  }

  const rel = await gh(`/repos/${EXT_REPO_SLUG}/releases/latest`);
  let data: ExtInfo;
  if (rel.rateLimited) {
    data = { latest: null, error: 'GitHub 接口限流，请稍后再试' };
  } else if (rel.data?.tag_name) {
    const assets: ExtAsset[] = (Array.isArray(rel.data.assets) ? rel.data.assets : [])
      /* 只挑 zip：仓库里可能还挂了别的产物，页面上只认安装包 */
      .filter((a: any) => /\.zip$/i.test(String(a?.name || '')))
      .map((a: any) => ({ name: String(a.name), size: Number(a.size || 0), url: String(a.browser_download_url || '') }));
    data = {
      latest: {
        version: String(rel.data.tag_name || ''),
        date: String(rel.data.published_at || rel.data.created_at || ''),
        url: String(rel.data.html_url || EXT_REPO + '/releases'),
        notes: String(rel.data.body || '').slice(0, 300),
        assets,
      },
    };
  } else {
    data = {
      latest: null,
      error: rel.status ? `GitHub 返回 ${rel.status}` : '读取插件仓库失败（网络或仓库地址变更）',
    };
  }

  if (data.latest) extCache = { at: now, data };
  return json({ ok: true, repo: EXT_REPO, repo_slug: EXT_REPO_SLUG, releases: EXT_REPO + '/releases', ...data, cached: false, cached_at: now });
}

/** 调 GitHub：先看 release（更接近「版本」语义），没有 release 就退回最新提交 */
async function fetchLatest(): Promise<LatestInfo> {
  const rel = await gh(`/repos/${REPO_SLUG}/releases/latest`);
  if (rel.rateLimited) return { ok: false, error: 'GitHub 接口限流，请稍后再试' };
  if (rel.data?.tag_name) {
    return {
      ok: true,
      kind: 'release',
      version: String(rel.data.tag_name),
      name: String(rel.data.name || rel.data.tag_name || ''),
      date: String(rel.data.published_at || rel.data.created_at || ''),
      url: String(rel.data.html_url || APP_REPO + '/releases'),
      sha: '',
      message: String(rel.data.body || '').slice(0, 160),
    };
  }

  const cm = await gh(`/repos/${REPO_SLUG}/commits?per_page=1`);
  if (cm.rateLimited) return { ok: false, error: 'GitHub 接口限流，请稍后再试' };
  const first = Array.isArray(cm.data) ? cm.data[0] : null;
  if (!first?.sha) {
    return { ok: false, error: cm.status ? `GitHub 返回 ${cm.status}` : '读取仓库信息失败（网络或仓库地址变更）' };
  }
  const msg = String(first.commit?.message || '').split('\n')[0];
  return {
    ok: true,
    kind: 'commit',
    version: '',
    name: msg,
    date: String(first.commit?.author?.date || first.commit?.committer?.date || ''),
    url: String(first.html_url || APP_REPO + '/commits'),
    sha: String(first.sha).slice(0, 7),
    message: msg,
  };
}

async function gh(path: string): Promise<{ status: number; data: any; rateLimited: boolean }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), GH_TIMEOUT);
  try {
    const res = await fetch('https://api.github.com' + path, {
      headers: {
        /* GitHub API 强制要求 UA，不写会直接 403 */
        'user-agent': 'udenav-about-check',
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
      signal: ctl.signal,
    });
    let data: any = null;
    try { data = await res.json(); } catch {}
    const rateLimited =
      (res.status === 403 || res.status === 429) &&
      (res.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(String(data?.message || '')));
    return { status: res.status, data, rateLimited };
  } catch {
    /* 超时 / DNS 失败都归到这里，交给上层给一句人话 */
    return { status: 0, data: null, rateLimited: false };
  } finally {
    clearTimeout(timer);
  }
}
