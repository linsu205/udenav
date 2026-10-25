// 公开接口：访客打开首页时读取配置 + 分组 + 卡片

import { json } from '../lib/http';
import { DEFAULT_CONFIG, type Env, type GroupRow, type IconRow, type ConfigRow } from '../lib/schema';

function parseConfig(rows: ConfigRow[]): Record<string, unknown> {
  const map: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const r of rows) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      /* 忽略坏值，用默认值 */
    }
  }
  return map;
}

/** 访问 IP 哈希入库，不存明文 IP */
async function hashIp(ip: string | undefined): Promise<string> {
  if (!ip) return 'unknown';
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ip));
  let out = '';
  for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
  return out.slice(0, 16);
}

export async function publicPanel(env: Env, req: Request): Promise<Response> {
  const [cfg, groups] = await Promise.all([
    env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>(),
    env.DB.prepare('SELECT * FROM item_icon_group WHERE public_hide = 0 ORDER BY sort, id').all<GroupRow>(),
  ]);
  const visible = groups.results.filter((g) => g.card_style !== 'hide');
  const ids = visible.map((g) => g.id);

  let icons: IconRow[] = [];
  if (ids.length) {
    icons = (await env.DB.prepare('SELECT * FROM item_icon WHERE group_id IN (' + ids.join(',') + ') ORDER BY sort, id').all<IconRow>()).results;
  }

  const byGroup = new Map<number, typeof icons>();
  for (const ic of icons) {
    const arr = byGroup.get(ic.group_id) || [];
    arr.push(ic);
    byGroup.set(ic.group_id, arr);
  }

  env.DB.prepare('INSERT INTO visit_log (path, ip_hash, count) VALUES (?, ?, 1)')
    .bind('panel', await hashIp((req.cf as { ip?: string } | undefined)?.ip))
    .run()
    .catch(() => {});

  return json({
    ok: true,
    config: parseConfig(cfg.results),
    groups: visible.map((g) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      icon: g.icon_type === 'iconify' ? g.icon_name : '',
      iconUrl: (g.icon_type === 'r2' || g.icon_type === 'data') ? g.icon_url : '',
      cardStyle: g.card_style,
      items: (byGroup.get(g.id) || []).map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url || r.lan_url,
        description: r.description,
        iconType: r.icon_type,
        iconText: r.icon_text,
        iconUrl: (r.icon_type === 'r2' || r.icon_type === 'data') ? r.icon_url : '',
        color: r.background_color,
        openMethod: r.open_method,
        sort: r.sort,
      })),
    })),
  });
}

export async function publicConfig(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>();
  return json({ ok: true, config: parseConfig(rows.results) });
}
