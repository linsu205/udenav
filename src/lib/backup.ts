// 备份 / 恢复：数据库快照（JSON）存到 R2，路径 backups/snapshot-<时间戳>.json

import { type Env, type GroupRow, type IconRow } from './schema';
import { bad } from './http';

export interface RestoreResult {
  groups: number;
  icons: number;
  configs: number;
}

export async function takeSnapshot(env: Env, tag = 'cron'): Promise<{ key: string; groups: number; icons: number }> {
  const [g, i, u, c] = await Promise.all([
    env.DB.prepare('SELECT * FROM item_icon_group ORDER BY sort, id').all<GroupRow>(),
    env.DB.prepare('SELECT * FROM item_icon ORDER BY group_id, sort, id').all<IconRow>(),
    env.DB.prepare('SELECT id, username, display_name, pass_meta, role, created_at FROM users').all(),
    env.DB.prepare('SELECT * FROM user_config').all(),
  ]);
  const key = `backups/snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}-${tag}.json`;
  const payload = {
    app: 'unav',
    created_at: Date.now(),
    config: c.results,
    users: u.results,
    groups: g.results,
    icons: i.results,
  };
  await env.BUCKET.put(key, JSON.stringify(payload, null, 1), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { tag },
  });
  return { key, groups: g.results.length, icons: i.results.length };
}

export async function listBackups(env: Env): Promise<Array<{ key: string; size: number; uploaded: string }>> {
  const list = await env.BUCKET.list({ prefix: 'backups/', limit: 50 });
  return list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded.toISOString() }));
}

/** 覆盖式恢复；返回坏结果时用 Response（bad）直接传出 */
export async function restoreSnapshot(env: Env, key: string): Promise<RestoreResult | Response> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return bad('备份不存在', 404);
  const raw = await obj.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return bad('备份文件已损坏', 400);
  }
  if (!data || !Array.isArray(data.groups)) return bad('备份格式不正确', 400);

  const cfgRows = Array.isArray(data.config) ? data.config : [];
  const groups: GroupRow[] = (data.groups || []) as GroupRow[];
  const icons: IconRow[] = (data.icons || []) as IconRow[];

  const stmts: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM item_icon'),
    env.DB.prepare('DELETE FROM item_icon_group'),
    env.DB.prepare('DELETE FROM user_config'),
  ];
  for (const c of cfgRows) stmts.push(env.DB.prepare('INSERT INTO user_config (key, value) VALUES (?, ?)').bind(String(c.key), String(c.value)));
  await env.DB.batch(stmts);

  // 保留原 id，便于卡片映射到正确分组
  await env.DB.batch(groups.map((g) =>
    env.DB.prepare('INSERT INTO item_icon_group (id, title, description, icon_type, icon_name, icon_url, sort, public_hide, card_style, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
      .bind(g.id, g.title, g.description, g.icon_type, g.icon_name, g.icon_url, g.sort, g.public_hide, g.card_style, Date.now()),
  ));

  const iconStmts = icons.map((ic) =>
    env.DB.prepare('INSERT INTO item_icon (id, group_id, title, url, lan_url, icon_type, icon_text, icon_url, description, open_method, background_color, sort, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)')
      .bind(ic.id, ic.group_id, ic.title, ic.url, ic.lan_url, ic.icon_type, ic.icon_text, ic.icon_url, ic.description, ic.open_method, ic.background_color, ic.sort, Date.now(), Date.now()),
  );
  for (let i = 0; i < iconStmts.length; i += 500) await env.DB.batch(iconStmts.slice(i, i + 500));

  return { groups: groups.length, icons: icons.length, configs: cfgRows.length };
}
