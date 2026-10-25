// 入口：静态资源由 wrangler 的 assets 自动返回，只有 /api/* 与未命中路径会进 fetch()
// 免费档预算：每次请求 ≤10ms CPU、≤50 个子请求 —— 所有路由都尽量少查库、走索引。

import { ensureSchemaOnce } from './lib/bootstrap';
import { withCors, bad } from './lib/http';
import { allow, ipOf } from './lib/ratelimit';
import { publicPanel, publicConfig } from './routes/public';
import * as admin from './routes/admin';
import { upload, serveIcon } from './routes/icons';
import * as bk from './routes/backup';
import { takeSnapshot } from './lib/backup';
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

    // 2) /icons/* → 从 R2 取图标（先查 Cache API）
    if (path.startsWith('/icons/')) {
      const key = path.slice('/icons/'.length);
      return serveIcon(env, req, key);
    }

    // 3) 其它 → 静态资源（index.html / admin.html / css / js ...）
    return env.ASSETS.fetch(req);
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    await takeSnapshot(env, 'cron').catch((e) => console.error('[backup] 定时备份失败', e));
  },
};

function preflight(req: Request, env: Env): Response {
  const h = new Headers({
    'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  });
  const o = req.headers.get('origin');
  if (o && env.CORS_ORIGIN && o === env.CORS_ORIGIN) h.set('access-control-allow-origin', o);
  else h.set('access-control-allow-origin', 'self');
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

async function dispatch(req: Request, env: Env, parts: string[], seg: string): Promise<Response | null> {
  const id = Number(parts[2]);
  const lim = async (scope: string, max: number): Promise<Response | null> => {
    const wait = allow(ipOf(req) + ':' + scope, max, 60);
    if (wait <= 0) return null;
    return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), {
      status: 429,
      headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': String(wait) },
    });
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
    const r = await lim('admin', 60);
    if (r) return r;
    const a = parts[1];
    const m = req.method.toUpperCase();

    if (m === 'POST' && a === 'login') return admin.login(env, req);
    if (m === 'POST' && a === 'register') return admin.register(env, req);
    if (m === 'POST' && a === 'logout') return admin.logout();
    if (m === 'POST' && a === 'upload') return upload(env, req);
    if (m === 'POST' && a === 'import') return admin.importAll(env, req);
    if (m === 'POST' && a === 'snapshot') return bk.snapshotNow(env, req);
    if (m === 'POST' && a === 'restore') return bk.restoreBackup(env, req);
    if (m === 'GET' && a === 'me') return admin.me(req, env);
    if (m === 'GET' && a === 'config') return admin.getConfig(env, req);
    if (m === 'GET' && a === 'groups') return admin.listGroups(env, req);
    if (m === 'GET' && a === 'icons') return admin.listIcons(env, req, new URL(req.url).searchParams);
    if (m === 'GET' && a === 'export') return admin.exportAll(env, req);
    if (m === 'GET' && a === 'backup') return bk.backupList(env, req);
    if (m === 'GET' && a === 'stats') return bk.stats(env, req);
    if (m === 'PUT' && a === 'config') return admin.putConfig(env, req);
    if (m === 'POST' && a === 'groups') return admin.createGroup(env, req);
    if (m === 'PATCH' && a === 'groups' && id) return admin.patchGroup(env, req, id);
    if (m === 'DELETE' && a === 'groups' && id) return admin.deleteGroup(env, req, id);
    if (m === 'POST' && a === 'icons') return admin.createIcon(env, req);
    if (m === 'PATCH' && a === 'icons' && id) return admin.patchIcon(env, req, id);
    if (m === 'DELETE' && a === 'icons' && id) return admin.deleteIcon(env, req, id);
  }

  // ---------- 图标文件已在顶层 fetch() 直接处理，不经过 /api ----------
  return null;
}
