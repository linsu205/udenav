// 入口：静态资源由 wrangler 的 assets 自动返回，只有 /api/* 会进 fetch()
// 免费档预算：每次请求 ≤10ms CPU、≤50 个子请求 —— 所有路由都尽量少查库、走索引。

import { ensureSchemaOnce } from './lib/bootstrap';
import { withCors, bad } from './lib/http';
import { allow, ipOf } from './lib/ratelimit';
import { publicPanel, publicConfig } from './routes/public';
import * as admin from './routes/admin';
import { upload } from './routes/icons';
import { iconifyProxy } from './routes/iconify';
import { getBackupCfg, putBackupCfg, runBackupNow, scheduledBackup, listBackups, restoreBackup, testBackupConn } from './routes/webdav';
import * as s3 from './routes/s3';
import { linkCheck } from './routes/linkcheck';
import { aboutInfo, checkLatest } from './routes/about';
import type { Env } from './lib/schema';

const API = '/api/';

/** 只用接口形状，避免依赖 Workers 版本里的具体类型名 */
interface Ctx {
  passThroughOnException: () => void;
  waitUntil: (p: Promise<unknown>) => void;
}

export default {
  async fetch(req: Request, env: Env, _ctx: Ctx): Promise<Response> {
    if (req.method === 'OPTIONS') return preflight(req, env);

    const path = new URL(req.url).pathname;

    // 1) /api/* → 后端路由
    if (path.startsWith(API)) {
      const res = await route(req, env);
      return withCors(req, res, env.CORS_ORIGIN);
    }

    // 2) /admin 短路径 → admin.html
    //    静态资源不做无扩展名解析，访客页弹窗里的 iframe 用的是 /admin，这里显式转一下，
    //    顺带让用户可以直接把 /admin 当独立地址打开
    if (path === '/admin' || path === '/admin/') {
      return env.ASSETS.fetch(new Request(new URL('/admin.html', req.url).toString(), req));
    }

    // 3) 其它 → 静态资源（index.html / admin.html / css / js ...）
    return env.ASSETS.fetch(req);
  },

  /* Cron Trigger：wrangler.toml 里配了 crons，Cloudflare 到点调用这里。
     放在 waitUntil 里，HTTP 响应（这里是空响应）不用等备份传完。 */
  async scheduled(_event: unknown, env: Env, ctx: Ctx): Promise<void> {
    /* 两个备份目标并行跑：各自判断自己的开关与执行策略，一个失败不影响另一个 */
    ctx.waitUntil(Promise.allSettled([scheduledBackup(env), s3.scheduledS3Backup(env)]));
  },
};

function preflight(req: Request, env: Env): Response {
  const o = req.headers.get('origin');
  const allowed = !!(o && env.CORS_ORIGIN && o === env.CORS_ORIGIN);
  const h = new Headers({
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    // 前端 api.ts 固定带 x-requested-with: unav，跨域时这是非简单头，预检必须放行否则真正的请求被拦
    'access-control-allow-headers': 'content-type,x-requested-with',
    'access-control-max-age': '86400',
  });
  if (allowed) {
    h.set('access-control-allow-origin', o!);
    h.set('access-control-allow-credentials', 'true');
    h.set('vary', 'origin');
  } else {
    h.set('access-control-allow-origin', 'self');
  }
  return new Response(null, { status: 204, headers: h });
}

async function route(req: Request, env: Env): Promise<Response> {
  try {
    await ensureSchemaOnce(env);
    const path = req.url.slice(req.url.indexOf(API) + API.length).split('?')[0];
    const parts = path.split('/').filter(Boolean);
    const seg = parts[0];

    const res = await dispatch(req, env, parts, seg);
    return res ?? bad('接口不存在', 404);
  } catch (e: any) {
    if (e && typeof e.httpStatus === 'number') return bad(e.message || '请求失败', e.httpStatus);
    console.error('[error]', e);
    return bad(e?.message || '服务器内部错误', 500);
  }
}

function tooMany(wait: number): Response {
  return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
    status: 429,
    headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(wait) },
  });
}

async function dispatch(req: Request, env: Env, parts: string[], seg: string): Promise<Response | null> {
  const id = Number(parts[2]);
  const m = req.method.toUpperCase();
  const lim = async (scope: string, max: number, windowSec = 60): Promise<Response | null> => {
    const wait = allow(ipOf(req) + ':' + scope, max, windowSec);
    if (wait <= 0) return null;
    return tooMany(wait);
  };

  // ---------- 公开 ----------
  if (seg === 'public') {
    const r = await lim('public', 120);
    if (r) return r;
    if (req.method !== 'GET') return bad('方法不支持', 405);
    if (parts[1] === 'panel') return publicPanel(env, req);
    if (parts[1] === 'config') return publicConfig(env);
  }

  // ---------- 管理员 ----------
  if (seg === 'admin') {
    const a = parts[1];

    // 防 CSRF：所有改变状态的 admin 请求必须带 X-Requested-With: unav。
    // 同源前端（api.ts / 访客页）统一带这个头；跨站伪造请求若想带自定义头，会触发
    // CORS 预检，而本服务的预检只放行 content-type，自定义头被浏览器拦掉 → 伪造请求全部失败。
    if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
      if (req.headers.get('x-requested-with') !== 'unav') {
        return bad('请求被拒绝（缺少 CSRF 令牌）', 403);
      }
    }

    const r = await lim('admin', 60);
    if (r) return r;

    if (m === 'POST' && a === 'login') {
      // 登录再加一层按 IP 的限流，和账号级锁定（5 次失败锁 30 分）互补，挡住撞库式爆破
      const wait = allow(ipOf(req) + ':login', 30, 300);
      if (wait > 0) return tooMany(wait);
      return admin.login(env, req);
    }
    if (m === 'GET' && a === 'setup') return admin.setupState(env);
    if (m === 'POST' && a === 'register') return admin.register(env, req);
    if (m === 'POST' && a === 'logout') return admin.logout();
    if (m === 'POST' && a === 'upload') return upload(env, req);
    if (m === 'POST' && a === 'import') return admin.importAll(env, req);
    if (m === 'GET' && a === 'me') return admin.me(req, env);
    if (m === 'GET' && a === 'config') return admin.getConfig(env, req);
    if (m === 'GET' && a === 'groups') return admin.listGroups(env, req);
    if (m === 'GET' && a === 'icons') return admin.listIcons(env, req, new URL(req.url).searchParams);
    if (m === 'GET' && a === 'favicon') return admin.favicon(env, req);
    if (m === 'GET' && a === 'images') return admin.listImages(env, req);
    if (m === 'DELETE' && a === 'images' && parts[2] && parts[3] !== undefined) return admin.clearImage(env, req, parts[2], parts[3]);
    if (m === 'GET' && a === 'export') return admin.exportAll(env, req);
    /* 对象存储备份（S3 兼容）：整块走 parts[2] === 's3' 判定，
       必须排在下面 backup 泛匹配之前，否则 /backup/s3 会被当成「读 WebDAV 配置」 */
    if (a === 'backup' && parts[2] === 's3') {
      const sub = parts[3];
      if (m === 'POST' && sub === 'run') return s3.runS3BackupNow(env, req);
      if (m === 'POST' && sub === 'test') return s3.testS3Conn(env, req);
      if (m === 'POST' && sub === 'restore') return s3.restoreS3Backup(env, req);
      if (m === 'GET' && sub === 'list') return s3.listS3Backups(env, req);
      if (m === 'GET' && !sub) return s3.getS3Cfg(env, req);
      if (m === 'PUT' && !sub) return s3.putS3Cfg(env, req);
    }
    /* 带子路径的要排在 /api/admin/backup 泛匹配前面，否则会被当成读配置 */
    if (m === 'GET' && a === 'backup' && parts[2] === 'list') return listBackups(env, req);
    if (m === 'POST' && a === 'backup' && parts[2] === 'restore') return restoreBackup(env, req);
    if (m === 'POST' && a === 'backup' && parts[2] === 'test') return testBackupConn(env, req);
    if (m === 'GET' && a === 'backup') return getBackupCfg(env, req);
    if (m === 'PUT' && a === 'backup') return putBackupCfg(env, req);
    if (m === 'POST' && a === 'backup') return runBackupNow(env, req);
    if (m === 'POST' && a === 'linkcheck') return linkCheck(env, req);
    /* 「关于」页：check 会打外网（GitHub），单独再限一层，别让按钮被连点成限流 */
    if (m === 'GET' && a === 'about') {
      const rl = await lim('about', 20);
      if (rl) return rl;
      if (parts[2] === 'check') return checkLatest(env, req);
      if (!parts[2]) return aboutInfo(env, req);
    }
    if (m === 'GET' && a === 'stats') return stats(env, req);
    if (m === 'GET' && a === 'users') return admin.listUsers(env, req);
    if (m === 'PATCH' && a === 'users' && id) return admin.patchUser(env, req, id);
    if (m === 'DELETE' && a === 'users' && id) return admin.deleteUser(env, req, id);
    if (m === 'PUT' && a === 'config') return admin.putConfig(env, req);
    if (m === 'POST' && a === 'groups') return admin.createGroup(env, req);
    if (m === 'PATCH' && a === 'groups' && id) return admin.patchGroup(env, req, id);
    if (m === 'DELETE' && a === 'groups' && id) return admin.deleteGroup(env, req, id);
    if (m === 'POST' && a === 'icons' && id && parts[3] === 'move') return admin.moveIcon(env, req, id);
    if (m === 'POST' && a === 'icons') return admin.createIcon(env, req);
    if (m === 'PATCH' && a === 'icons' && id) return admin.patchIcon(env, req, id);
    if (m === 'DELETE' && a === 'icons' && id) return admin.deleteIcon(env, req, id);
    if (m === 'DELETE' && a === 'logs') return admin.purgeLogs(env, req);
  }

  // ---------- 公开：在线图标代理（无鉴权，按 IP 限速即可）----------
  if (req.method === 'GET' && seg === 'icon') {
    const r = await lim('icon', 120);
    if (r) return r;
    return iconifyProxy(req);
  }

  return null;
}
// 统计接口（原来在 routes/backup.ts 里，随 R2 备份一起移除，独立保留在这里）
// ============================================================

/**
 * 存储占用统计口径。
 * Workers 是 Serverless 运行环境，没有本地文件系统，所以"空间占用"只统计 D1 里真实写入的数据：
 *  - TEXT 列：LENGTH(CAST(COALESCE(col,'') AS BLOB)) —— SQLite 的 LENGTH() 只算字符数，
 *    UTF-8 下一个汉字占 3 字节会被算成 1，必须 CAST 成 BLOB 才拿到真实字节数
 *  - 数字 / 布尔列：每行按 8 字节计（num 是该表这类列的个数）
 * D1 不支持 PRAGMA，列清单只能在这里显式写死，改表结构要同步改。
 */
const STORED: Array<{ key: string; label: string; color: string; text: string[]; num: number }> = [
  { key: 'visit_log', label: '访问日志', color: '#409eff', text: ['path', 'ip_hash', 'ua'], num: 3 },
  { key: 'item_icon', label: '卡片数据', color: '#2fbf6b', text: ['title', 'url', 'lan_url', 'icon_type', 'icon_text', 'icon_url', 'description', 'background_color'], num: 8 },
  { key: 'item_icon_group', label: '分组数据', color: '#e6a23c', text: ['title', 'description', 'icon_type', 'icon_name', 'icon_url'], num: 7 },
  { key: 'users', label: '后台账户', color: '#a78bfa', text: ['username', 'display_name', 'pass_meta', 'role'], num: 5 },
  { key: 'panel', label: '面板数据', color: '#67c23a', text: ['key', 'value'], num: 3 },
  { key: 'user_config', label: '用户配置', color: '#909399', text: ['key', 'value'], num: 2 },
  { key: 'schema_meta', label: '版本元数据', color: '#8492a6', text: ['key', 'value'], num: 0 },
];

const TZ_OFFSET = 8 * 3600; // 东八区秒偏移，日期归组用（D1 容器时区是 UTC）

function storeSql(t: { key: string; text: string[]; num: number }): string {
  const sum = t.text.map((c) => `LENGTH(CAST(COALESCE(${c}, '') AS BLOB))`).join(' + ');
  const body = t.text.length ? `COALESCE(SUM(${sum}), 0)` : '0';
  const fixed = t.num ? ` + COUNT(*) * ${t.num * 8}` : '';
  return `SELECT COUNT(*) AS rows, (${body})${fixed} AS bytes FROM ${t.key}`;
}

async function stats(env: Env, req: Request): Promise<Response> {
  const s = await admin.getSession(env, req);
  if (!s) return bad('未登录', 401);

  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor((now - TZ_OFFSET) / 86400) * 86400 + TZ_OFFSET; // 东八区当天 0 点
  const trendLo = dayStart - 13 * 86400; // 含今天共 14 天

  const [base, storedRaw, trendRaw, iconRaw, linkRaw, logRaw] = await Promise.all([
    Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log WHERE ts >= ?').bind(dayStart).first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log WHERE ts >= ?').bind(now - 86400).first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon_group').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM user_config').first<{ n: number }>(),
    ]),
    Promise.all(STORED.map((t) => env.DB.prepare(storeSql(t)).first<{ rows: number; bytes: number }>())),
    env.DB.prepare(
      `SELECT strftime('%Y-%m-%d', ts + ${TZ_OFFSET}, 'unixepoch') AS day, COALESCE(SUM("count"), 0) AS n
       FROM visit_log WHERE ts >= ? GROUP BY day`
    ).bind(trendLo).all<{ day: string; n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(CAST(icon_url AS BLOB))), 0) AS bytes,
              COALESCE(MAX(LENGTH(CAST(icon_url AS BLOB))), 0) AS mx
       FROM (SELECT icon_url FROM item_icon UNION ALL SELECT icon_url FROM item_icon_group)
       WHERE icon_url LIKE 'data:%'`
    ).first<{ n: number; bytes: number; mx: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM (SELECT icon_url FROM item_icon UNION ALL SELECT icon_url FROM item_icon_group)
       WHERE icon_url <> ''`
    ).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT ip_hash) AS ips, COUNT(DISTINCT ua) AS uas, MIN(ts) AS oldest, MAX(ts) AS newest
       FROM visit_log WHERE ip_hash <> ''`
    ).first<{ ips: number; uas: number; oldest: number; newest: number }>(),
  ]);

  // 14 天趋势：数据库只返回有访问的日期，缺的天补 0
  const trendMap = new Map(trendRaw.results.map((r) => [r.day, Number(r.n) || 0]));
  const trend: Array<{ day: string; n: number }> = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date((now - i * 86400 + TZ_OFFSET) * 1000).toISOString().slice(0, 10);
    trend.push({ day, n: trendMap.get(day) ?? 0 });
  }

  const bytesTotal = storedRaw.reduce((a, r) => a + (r?.bytes ?? 0), 0);
  const rowsTotal = storedRaw.reduce((a, r) => a + (r?.rows ?? 0), 0);
  const storeList = STORED.map((t, i) => {
    const bytes = Number(storedRaw[i]?.bytes ?? 0);
    const rows = Number(storedRaw[i]?.rows ?? 0);
    return {
      key: t.key, label: t.label, color: t.color, rows, bytes,
      pct: bytesTotal ? Math.round((bytes / bytesTotal) * 1000) / 10 : 0,
    };
  }).sort((a, b) => b.bytes - a.bytes);

  const logRow = storedRaw.find((_, i) => STORED[i].key === 'visit_log');
  const j = {
    ok: true,
    total_visits: base[0]?.n ?? 0,
    visits_today: base[1]?.n ?? 0,
    visits_24h: base[2]?.n ?? 0,
    groups: base[3]?.n ?? 0,
    icons: base[4]?.n ?? 0,
    users: base[5]?.n ?? 0,
    config_keys: base[6]?.n ?? 0,
    trend,
    db: { tables: STORED.length, rows_total: rowsTotal, bytes_total: bytesTotal, list: storeList },
    icon: {
      inline: iconRaw?.n ?? 0, inline_bytes: iconRaw?.bytes ?? 0, inline_max: iconRaw?.mx ?? 0,
      linked: (linkRaw?.n ?? 0) - (iconRaw?.n ?? 0),
    },
    log: {
      rows: Number(logRow?.rows ?? 0), bytes: Number(logRow?.bytes ?? 0),
      ips: logRaw?.ips ?? 0, uas: logRaw?.uas ?? 0,
      oldest: logRaw?.oldest ?? null, newest: logRaw?.newest ?? null,
      /* 超限提示：前端据此决定是否弹「建议清理」 */
      warn: Number(logRow?.rows ?? 0) >= admin.LOG_WARN_ROWS || Number(logRow?.bytes ?? 0) >= admin.LOG_WARN_BYTES,
      warn_rows: admin.LOG_WARN_ROWS,
      warn_bytes: admin.LOG_WARN_BYTES,
    },
    session: { username: s.username, role: s.role },
  };
  return new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json; charset=utf-8' } });
}
