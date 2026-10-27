// 管理接口：登录 / 注册 / 配置 / 分组 / 卡片 / 导入导出
// 全部要求 owner 或 editor 会话；写操作限流。

import { json, bad, q, num, numBody, readJson, httpErr } from '../lib/http';
import { hashPassword, verifyPassword, signToken, verifyToken, setSessionCookie, clearSessionCookie, readSessionCookie, requireAccess, type Session, type Role, nowSec } from '../lib/auth';
import { DEFAULT_CONFIG, type Env, type GroupRow, type IconRow, type IconType, type ConfigRow } from '../lib/schema';
import { getSecret } from '../lib/secret';

const SESSION_HOURS = 24;
const LOGIN_MAX_FAILS = 5;
const LOCK_SEC = 1800;

/* ---------------- 鉴权 ---------------- */

export async function getSession(env: Env, req: Request): Promise<Session | null> {
  if (!requireAccess(req)) return null;
  const token = readSessionCookie(req);
  if (!token) return null;
  return verifyToken(token, await getSecret(env));
}

export function deny(res: Response): Response {
  return withSetCookie(res, clearSessionCookie());
}

function withSetCookie(res: Response, cookie: string): Response {
  const h = new Headers(res.headers);
  h.set('set-cookie', cookie);
  return new Response(res.body, { status: res.status, headers: h });
}

export async function requireRole(req: Request, env: Env, role: Role): Promise<Session> {
  const s = await getSession(env, req);
  if (!s) throw httpErr('未登录', 401);
  if (role === 'owner' && s.role !== 'owner') throw httpErr('需要管理员权限', 403);
  return s;
}

/* ---------------- 口令强度 ---------------- */

function checkPassword(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return '密码至少 8 位';
  if (/^[\x00-\x1F\s]*$/.test(pw)) return '密码不能只有空白字符';
  return null;
}

function normIconType(v: unknown): IconType {
  return v === 'iconify' || v === 'data' || v === 'r2' || v === 'color' ? v : 'color';
}

function hasImageIcon(iconType: IconType, iconUrl: string): boolean {
  return iconType === 'data' || iconType === 'r2' || iconUrl.startsWith('data:');
}

/* ---------------- 路由 ---------------- */

/**
 * 是否还需要「首次注册」。
 * 本项目是单租户：第一个账号就是唯一 owner，注册入口随后永久关闭。
 * 前端登录页据此决定显不显示「注册」，避免用户看到一个点了必然失败的入口。
 */
export async function setupState(env: Env): Promise<Response> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return json({ ok: true, need_setup: !(n && n.n > 0) });
}

export async function register(env: Env, req: Request): Promise<Response> {
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if (n && n.n > 0) return bad('已存在账号，不能注册（如需新增用户请用管理员界面）', 403);
  const body = await readJson(req) as { username?: string; password?: string };
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return bad('用户名只能是 3-20 位字母/数字/下划线');
  const weak = checkPassword(password);
  if (weak) return bad(weak);

  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  const res = await env.DB
    .prepare('INSERT INTO users (username, pass_meta, role) VALUES (?, ?, ?)')
    .bind(username, JSON.stringify({ iter: 15000, salt, hash }), 'owner')
    .run();
  if (!res.success) return bad('用户名已被占用', 409);
  const token = await signToken({ sub: Number(res.meta.last_row_id), username, role: 'owner', exp: nowSec() + SESSION_HOURS * 3600 }, await getSecret(env));
  return json({ ok: true, username, role: 'owner' }, { headers: { 'set-cookie': setSessionCookie(token, SESSION_HOURS * 3600, req.url.startsWith('https://')) } });
}

function randomSalt(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

export async function login(env: Env, req: Request): Promise<Response> {
  const body = await readJson(req) as { username?: string; password?: string };
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<{
    id: number; username: string; pass_meta: string; role: Role; failed_login: number; lock_until: number;
  }>();
  if (!user) return bad('用户名或密码错误', 401);

  if (user.lock_until > nowSec()) return bad('失败次数过多，请稍后再试', 423);

  const ok = await verifyPassword(password, user.pass_meta);
  if (!ok) {
    const fails = user.failed_login + 1;
    const lock = fails >= LOGIN_MAX_FAILS;
    await env.DB
      .prepare('UPDATE users SET failed_login = ?, lock_until = ? WHERE id = ?')
      .bind(fails, lock ? nowSec() + LOCK_SEC : user.lock_until, user.id)
      .run();
    return bad(lock ? '已锁定 30 分钟' : '用户名或密码错误', 401);
  }

  await env.DB.prepare('UPDATE users SET failed_login = 0, lock_until = 0 WHERE id = ?').bind(user.id).run();
  const token = await signToken({ sub: user.id, username: user.username, role: user.role, exp: nowSec() + SESSION_HOURS * 3600 }, await getSecret(env));
  return json({ ok: true, username: user.username, role: user.role }, { headers: { 'set-cookie': setSessionCookie(token, SESSION_HOURS * 3600, req.url.startsWith('https://')) } });
}

export async function logout(): Promise<Response> {
  return json({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } });
}

export async function me(req: Request, env: Env): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return json({ ok: false, logged_in: false });
  return json({ ok: true, logged_in: true, username: s.username, role: s.role, exp: s.exp });
}

/* ---------------- 用户管理 ---------------- */
// 单租户项目：正常只有一个账号。这里提供「改名 / 改密 / 解锁 / 删号」，
// 用来替代以前只能改库或删库重来的做法。
// 口令同样只存 PBKDF2 哈希，所以改密 = 生成新 salt + hash 覆盖写回。

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

type UserRow = {
  id: number; username: string; role: Role;
  failed_login: number; lock_until: number; created_at: number;
};

function userView(u: UserRow, selfId: number) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    failed_login: u.failed_login,
    locked: u.lock_until > nowSec(),
    lock_until: u.lock_until,
    created_at: u.created_at,
    self: u.id === selfId,
  };
}

export async function listUsers(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const rows = await env.DB
    .prepare('SELECT id, username, role, failed_login, lock_until, created_at FROM users ORDER BY id')
    .all<UserRow>();
  return json({ ok: true, users: rows.results.map((u) => userView(u, s.sub)) });
}

/**
 * 修改账号。
 *  body: { username?: string, password?: string, unlock?: boolean }
 *  - username 只在真的变了才校验重名
 *  - password 省略或空串表示不改；改了会清零失败次数与锁定
 *  - unlock: true 只解锁，不动密码
 * 改自己的用户名时补发一张新 JWT —— 否则 /me 还会返回旧名字，侧栏显示对不上。
 */
export async function patchUser(env: Env, req: Request, id: number): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const body = await readJson(req);

  const cur = await env.DB
    .prepare('SELECT id, username, role FROM users WHERE id = ?')
    .bind(id)
    .first<{ id: number; username: string; role: Role }>();
  if (!cur) return bad('账号不存在', 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  let renamed: string | null = null;

  if (body?.username !== undefined) {
    const username = String(body.username || '').trim();
    if (username !== cur.username) {
      if (!USERNAME_RE.test(username)) return bad('用户名只能是 3-20 位字母/数字/下划线');
      const dup = await env.DB
        .prepare('SELECT id FROM users WHERE username = ? AND id <> ?')
        .bind(username, id)
        .first<{ id: number }>();
      if (dup) return bad('该用户名已被占用', 409);
      sets.push('username = ?');
      binds.push(username);
      renamed = username;
    }
  }

  let pwdChanged = false;
  if (body?.password !== undefined && body.password !== '' && body.password !== null) {
    const password = String(body.password);
    const weak = checkPassword(password);
    if (weak) return bad(weak);
    const salt = randomSalt();
    sets.push('pass_meta = ?');
    binds.push(JSON.stringify({ iter: 15000, salt, hash: await hashPassword(password, salt) }));
    sets.push('failed_login = 0', 'lock_until = 0');
    pwdChanged = true;
  }

  if (body?.unlock === true) {
    if (!pwdChanged) sets.push('failed_login = 0', 'lock_until = 0');
  }

  if (!sets.length) return json({ ok: true, changed: 0, username: cur.username, renamed: false, password_changed: false });

  await env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds, id).run();

  const out = {
    ok: true, changed: 1,
    username: renamed ?? cur.username,
    renamed: !!renamed,
    password_changed: pwdChanged,
  };

  if (renamed && s.sub === id) {
    const token = await signToken(
      { sub: id, username: renamed, role: cur.role, exp: nowSec() + SESSION_HOURS * 3600 },
      await getSecret(env),
    );
    return json(out, {
      headers: { 'set-cookie': setSessionCookie(token, SESSION_HOURS * 3600, req.url.startsWith('https://')) },
    });
  }
  return json(out);
}

/** 删号：不能删自己，也不能把最后一个账号删掉（否则会重新回到首次注册态） */
export async function deleteUser(env: Env, req: Request, id: number): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  if (s.sub === id) return bad('不能删除当前登录的账号', 400);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((n?.n ?? 0) <= 1) return bad('至少要保留一个账号', 400);
  const res = await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
  if (!Number(res?.meta?.changes ?? 0)) return bad('账号不存在', 404);
  return json({ ok: true });
}

/* ---------------- 配置 ---------------- */

function cfgPatch(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(DEFAULT_CONFIG) as Array<keyof typeof DEFAULT_CONFIG>) {
    if (!(k in body)) continue;
    const v = body[k];
    if (v === undefined || v === null) continue;
    out[k] = k === 'search_engines' ? (Array.isArray(v) ? v.slice(0, 10) : body[k]) : v;
  }
  return out;
}

export async function getConfig(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const rows = await env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>();
  const out: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const r of rows.results) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* skip */ }
  }
  return json({ ok: true, config: out });
}

export async function putConfig(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const patch = cfgPatch(body);
  const stmts = Object.entries(patch).map(([k, v]) =>
    env.DB.prepare('INSERT INTO user_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = ?').bind(k, JSON.stringify(v), Date.now()),
  );
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true, updated: Object.keys(patch).length, by: s.username });
}

/* ---------------- 分组 ---------------- */

export async function listGroups(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const groups = await env.DB.prepare('SELECT * FROM item_icon_group ORDER BY sort, id').all<GroupRow>();
  const counts = await env.DB.prepare('SELECT group_id, COUNT(*) AS n FROM item_icon GROUP BY group_id').all<{ group_id: number; n: number }>();
  const m = new Map(counts.results.map((r) => [r.group_id, r.n]));
  return json({ ok: true, groups: groups.results.map((g) => ({ ...g, icon_count: m.get(g.id) || 0 })) });
}

export async function createGroup(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const title = String(body.title || '').trim();
  if (!title) return bad('分组名不能为空');
  const next = await env.DB.prepare('SELECT COALESCE(MAX(sort), -10) AS n FROM item_icon_group').first<{ n: number }>();
  const res = await env.DB
    .prepare('INSERT INTO item_icon_group (title, description, icon_type, icon_name, icon_url, sort, public_hide, public_show, card_style, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(title, String(body.description || ''), body.icon_type || 'iconify', String(body.icon_name || ''), String(body.icon_url || ''), Number(next?.n ?? -10) + 10, body.public_hide ? 1 : 0, body.public_show ? 1 : 0, body.card_style || 'info', s.sub)
    .run();
  return json({ ok: true, id: Number(res.meta.last_row_id) });
}

export async function patchGroup(env: Env, req: Request, id: number): Promise<Response> {
  await requireRole(req, env, 'editor');
  const g = await env.DB.prepare('SELECT * FROM item_icon_group WHERE id = ?').bind(id).first<GroupRow>();
  if (!g) return bad('分组不存在', 404);
  const body = await readJson(req);
  const title = body.title !== undefined ? String(body.title).trim() : g.title;
  if (!title) return bad('分组名不能为空');
  /* 与 SQL 列一一对应，别再用下标索引元组数组（之前 fields[7] 越界必然 500） */
  const description = String(body.description ?? g.description);
  const icon_type = body.icon_type ?? g.icon_type;
  const icon_name = String(body.icon_name ?? g.icon_name);
  const icon_url = String(body.icon_url ?? g.icon_url);
  const sort = numBody(body, 'sort', g.sort, -1e7, 1e7);
  const public_hide = (body.public_hide ?? g.public_hide) ? 1 : 0;
  const public_show = (body.public_show ?? g.public_show) ? 1 : 0;
  const card_style = body.card_style ?? g.card_style;
  await env.DB
    .prepare('UPDATE item_icon_group SET title=?, description=?, icon_type=?, icon_name=?, icon_url=?, sort=?, public_hide=?, public_show=?, card_style=? WHERE id=?')
    .bind(title, description, icon_type, icon_name, icon_url, sort, public_hide, public_show, card_style, id)
    .run();
  return json({ ok: true });
}

export async function deleteGroup(env: Env, req: Request, id: number): Promise<Response> {
  await requireRole(req, env, 'editor');
  const g = await env.DB.prepare('SELECT * FROM item_icon_group WHERE id = ?').bind(id).first<GroupRow>();
  if (!g) return bad('分组不存在', 404);
  const res = await env.DB.prepare('DELETE FROM item_icon WHERE group_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM item_icon_group WHERE id = ?').bind(id).run();
  return json({ ok: true, removed_icons: Number(res?.meta?.changes ?? 0) });
}

/* ---------------- 卡片 ---------------- */

export async function listIcons(env: Env, req: Request, params: URLSearchParams): Promise<Response> {
  await requireRole(req, env, 'editor');
  const gid = num(params, 'group_id', 0, 0);
  let icons: IconRow[];
  if (gid) {
    icons = (await env.DB.prepare('SELECT * FROM item_icon WHERE group_id = ? ORDER BY sort, id').bind(gid).all<IconRow>()).results;
  } else {
    icons = (await env.DB.prepare('SELECT * FROM item_icon ORDER BY group_id, sort, id').all<IconRow>()).results;
  }
  return json({ ok: true, icons });
}

export async function createIcon(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const gid = Number(body.group_id || 0);
  const title = String(body.title || '').trim();
  if (!gid) return bad('缺少分组');
  if (!title) return bad('名称不能为空');
  const g = await env.DB.prepare('SELECT id FROM item_icon_group WHERE id = ?').bind(gid).first();
  if (!g) return bad('分组不存在', 404);
  const next = await env.DB.prepare('SELECT COALESCE(MAX(sort), -10) AS n FROM item_icon WHERE group_id = ?').bind(gid).first<{ n: number }>();
  const icon_type: IconType = normIconType(body.icon_type);
  const res = await env.DB
    .prepare('INSERT INTO item_icon (group_id, title, url, lan_url, icon_type, icon_text, icon_url, description, open_method, background_color, sort, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(gid, title, String(body.url || ''), String(body.lan_url || ''), icon_type, String(body.icon_text || ''), String(body.icon_url || ''), String(body.description || ''), Number(body.open_method ?? 2), String(body.background_color ?? ''), Number(next?.n ?? -10) + 10, s.sub)
    .run();
  return json({ ok: true, id: Number(res.meta.last_row_id) });
}

export async function patchIcon(env: Env, req: Request, id: number): Promise<Response> {
  await requireRole(req, env, 'editor');
  const ic = await env.DB.prepare('SELECT * FROM item_icon WHERE id = ?').bind(id).first<IconRow>();
  if (!ic) return bad('卡片不存在', 404);
  const body = await readJson(req);
  const title = body.title !== undefined ? String(body.title).trim() : ic.title;
  if (!title) return bad('名称不能为空');
  const icon_type: IconType = normIconType(body.icon_type);
  // 背景色：必须区分「没传这个字段」与「传了但为 null（用户点清除颜色）」。
  // el-color-picker 清除后 v-model 为 null，用 ?? 兜底会把 null 当成未传而回退旧色，导致清不掉。
  const hasBg = Object.prototype.hasOwnProperty.call(body, 'background_color');
  const bgColor = hasBg ? String(body.background_color ?? '') : ic.background_color;
  await env.DB
    .prepare('UPDATE item_icon SET title=?, url=?, lan_url=?, icon_type=?, icon_text=?, icon_url=?, description=?, open_method=?, background_color=?, sort=?, updated_at=? WHERE id=?')
    .bind(title, String(body.url ?? ic.url), String(body.lan_url ?? ic.lan_url), icon_type, String(body.icon_text ?? ic.icon_text), String(body.icon_url ?? ic.icon_url), String(body.description ?? ic.description), Number(body.open_method ?? ic.open_method), bgColor, Number(body.sort ?? ic.sort), Date.now(), id)
    .run();
  return json({ ok: true });
}

export async function deleteIcon(env: Env, req: Request, id: number): Promise<Response> {
  await requireRole(req, env, 'editor');
  const res = await env.DB.prepare('DELETE FROM item_icon WHERE id = ?').bind(id).run();
  return json({ ok: true, changed: Number(res?.meta?.changes ?? 0) });
}

/* ---------------- 访问日志清理 ---------------- */

/* 日志“该清了”的建议上限：任一超出，统计页就弹提示。两个值都不影响系统运行，
   只是给一个明确的清理时机，避免行数无限累积后 COUNT(*) 变慢。 */
export const LOG_WARN_ROWS = 5000;
export const LOG_WARN_BYTES = 2 * 1024 * 1024;

/**
 * 清理访问日志。
 *  body: { mode: 'all' }                     清空全部
 *        { mode: 'days', days: 30 }          只留最近 N 天（默认 30，1..3650）
 * 单租户下只有一个 owner 账号，仍按 owner 校验，与导入导出保持一致的破坏性操作门槛。
 */
export async function purgeLogs(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const mode = body?.mode === 'all' ? 'all' : 'days';

  if (mode === 'all') {
    const res = await env.DB.prepare('DELETE FROM visit_log').run();
    return json({ ok: true, mode, deleted: Number(res?.meta?.changes ?? 0), keep_days: null });
  }

  const days = Math.max(1, Math.min(3650, Math.floor(Number(body?.days) || 30)));
  const cutoff = nowSec() - days * 86400;
  const res = await env.DB.prepare('DELETE FROM visit_log WHERE ts < ?').bind(cutoff).run();
  return json({ ok: true, mode, deleted: Number(res?.meta?.changes ?? 0), keep_days: days });
}

/* ---------------- 导入导出 ---------------- */

export async function exportAll(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const [g, i, c, u] = await Promise.all([
    env.DB.prepare('SELECT * FROM item_icon_group ORDER BY sort, id').all<GroupRow>(),
    env.DB.prepare('SELECT * FROM item_icon ORDER BY group_id, sort, id').all<IconRow>(),
    env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>(),
    env.DB.prepare('SELECT id, username, display_name, role, created_at FROM users').all(),
  ]);
  return json({
    ok: true,
    app: 'udenav',
    exported_at: Date.now(),
    config: c.results.map((r) => ({ key: r.key, value: safeParse(r.value) })),
    users: u.results.map((r) => ({ ...r, password: '<请用 JSON 导入界面单独设置>' })),
    groups: g.results,
    icons: i.results,
  });
}

function safeParse(v: string): unknown {
  try { return JSON.parse(v); } catch { return v; }
}

export async function importAll(env: Env, req: Request): Promise<Response> {
  const s = await requireRole(req, env, 'owner');
  const body = await readJson(req) as any;
  if (!body || !Array.isArray(body.groups)) return bad('导入内容缺少 groups 数组');
  const confirm = String(body.confirm || '') === 'restore';

  const cfg = body.config || [];
  const groups = body.groups || [];
  const icons = body.icons || [];

  const stmts: D1PreparedStatement[] = [env.DB.prepare('DELETE FROM item_icon'), env.DB.prepare('DELETE FROM item_icon_group'), env.DB.prepare('DELETE FROM user_config')];
  for (const c of cfg) stmts.push(env.DB.prepare('INSERT INTO user_config (key, value) VALUES (?, ?)').bind(String(c.key), JSON.stringify(c.value ?? '')));
  for (const g of groups) {
    stmts.push(env.DB.prepare('INSERT INTO item_icon_group (id, title, description, icon_type, icon_name, icon_url, sort, public_hide, public_show, card_style, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(Number(g.id), String(g.title), String(g.description ?? ''), g.icon_type || 'iconify', String(g.icon_name ?? ''), String(g.icon_url ?? ''), Number(g.sort ?? 0), g.public_hide ? 1 : 0, g.public_show ? 1 : 0, g.card_style || 'info', s.sub));
  }
  for (const ic of icons) {
    stmts.push(env.DB.prepare('INSERT INTO item_icon (id, group_id, title, url, lan_url, icon_type, icon_text, icon_url, description, open_method, background_color, sort, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(Number(ic.id), Number(ic.group_id), String(ic.title), String(ic.url ?? ''), String(ic.lan_url ?? ''), ic.icon_type || 'color', String(ic.icon_text ?? ''), String(ic.icon_url ?? ''), String(ic.description ?? ''), Number(ic.open_method ?? 2), String(ic.background_color ?? '#2a2a2a6b'), Number(ic.sort ?? 0), s.sub));
  }

  /* D1 的 batch 是单个事务：全部成功或全部回滚。
     以前分 4 次 batch（清空 / 配置 / 分组 / 卡片），一旦后面失败，
     前面的 DELETE 已经生效——旧数据没了、新数据只进来一半。
     500 条以内一次事务完成；超大备份才退化成分批（batch 语句数有上限）。 */
  if (stmts.length <= 500) {
    await env.DB.batch(stmts);
  } else {
    for (let i = 0; i < stmts.length; i += 500) await env.DB.batch(stmts.slice(i, i + 500));
  }

  if (body.users && Array.isArray(body.users)) {
    for (const u of body.users) {
      /* 导出时密码被替换成占位符「<请用 JSON 导入界面单独设置>」，
         必须跳过——不跳过就会把占位符当成真密码写进库，导入一次全体账号都登不上。 */
      const pw = u.password ? String(u.password) : '';
      if (!pw || pw.startsWith('<')) continue;
      const salt = randomSalt();
      const hash = await hashPassword(String(u.password), salt);
      await env.DB.prepare('INSERT INTO users (username, pass_meta, role) VALUES (?, ?, ?) ON CONFLICT(username) DO UPDATE SET pass_meta = excluded.pass_meta').bind(String(u.username), JSON.stringify({ iter: 15000, salt, hash }), u.role || 'editor').run();
    }
  }

  return json({ ok: true, confirm_used: confirm, groups: groups.length, icons: icons.length, configs: cfg.length });
}

/* ---------------- 根据网址抓取站点图标（参照 sun-panel「获取图标」） ---------------- */

const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGE_BYTES = 300_000;    // 页面 HTML 最多读 300KB，够解析 <link> 了
const MAX_ICON_BYTES = 300 * 1024; // 图标最大 300KB

function sniffImage(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf, 0, Math.min(16, buf.byteLength));
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  const head = String.fromCharCode(...b).toLowerCase();
  if (head.includes('<svg') || head.includes('<?xml')) return 'image/svg+xml';
  return null;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

async function fetchT(url: string, ua: string): Promise<Response> {
  return fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': ua, 'accept': '*/*' },
  });
}

export async function favicon(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);
  const raw = (new URL(req.url).searchParams.get('url') || '').trim();
  if (!raw) return bad('缺少 url 参数');
  let target: URL;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
  } catch { return bad('网址格式不正确'); }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return bad('仅支持 http/https 网址');

  const UA = 'Mozilla/5.0 (compatible; unav-icon-fetch/1.0)';
  const candidates: string[] = [];

  // 1) 抓首页，解析 <link rel="...icon...">，apple-touch-icon 优先（通常最大最清晰）
  try {
    const page = await fetchT(target.toString(), UA);
    if (page.ok) {
      const html = (await page.text()).slice(0, MAX_PAGE_BYTES);
      const base = page.url || target.toString();
      const found: { w: number; href: string }[] = [];
      const re = /<link\b[^>]*>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) {
        const tag = m[0];
        const rel = (tag.match(/\brel\s*=\s*["']([^"']*)["']/i)?.[1] || '').toLowerCase();
        const href = tag.match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] || '';
        if (!href || !rel.split(/\s+/).some(r => r.includes('icon'))) continue;
        const w = rel.includes('apple-touch') ? 0 : rel.includes('shortcut') ? 1 : 2;
        found.push({ w, href });
      }
      found.sort((a, b) => a.w - b.w);
      for (const f of found) { try { candidates.push(new URL(f.href, base).toString()); } catch { /* 跳过坏地址 */ } }
    }
  } catch { /* 首页抓不到，直接试 favicon.ico 兜底 */ }

  // 2) 兜底：站点根目录 favicon.ico
  candidates.push(new URL('/favicon.ico', target.origin).toString());

  for (const u of candidates) {
    try {
      const r = await fetchT(u, UA);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength === 0 || buf.byteLength > MAX_ICON_BYTES) continue;
      const declared = (r.headers.get('content-type') || '').toLowerCase();
      const ct = declared.startsWith('image/') ? declared.split(';')[0] : sniffImage(buf);
      if (!ct) continue;
      return json({ ok: true, icon: 'data:' + ct + ';base64,' + toBase64(buf) });
    } catch { /* 试下一个候选 */ }
  }
  return bad('未找到可用图标', 404);
}
