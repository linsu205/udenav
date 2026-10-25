// 备份 / 恢复 / 统计

import { bad, q } from '../lib/http';
import { type Env } from '../lib/schema';
import { getSession, requireRole } from './admin';
import { takeSnapshot, restoreSnapshot, listBackups } from '../lib/backup';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function snapshotNow(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);
  const r = await takeSnapshot(env, 'manual');
  return json({ ok: true, ...r });
}

export async function backupList(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);
  return json({ ok: true, backups: await listBackups(env) });
}

export async function restoreBackup(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const key = q(new URL(req.url).searchParams, 'key');
  if (!key.startsWith('backups/')) return bad('key 必须以 backups/ 开头');
  const r = await restoreSnapshot(env, key);
  if (r instanceof Response) return r;
  return json({ ok: true, by: s.username, ...r });
}

export async function stats(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);
  const [visits, today, groups, icons, users, cfg] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM visit_log WHERE ts >= ?').bind(Math.floor(Date.now() / 1000) - 86400).first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon_group').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM item_icon').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM user_config').first<{ n: number }>(),
  ]);
  const top = await env.DB.prepare('SELECT title, COUNT(*) AS n FROM item_icon GROUP BY title ORDER BY n DESC LIMIT 1').all();
  return json({
    ok: true,
    total_visits: visits?.n ?? 0,
    visits_24h: today?.n ?? 0,
    groups: groups?.n ?? 0,
    icons: icons?.n ?? 0,
    users: users?.n ?? 0,
    config_keys: cfg?.n ?? 0,
    session: { username: s.username, role: s.role },
  });
}
