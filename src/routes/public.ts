// 公开接口：访客打开首页时读取配置 + 分组 + 卡片

import { json } from '../lib/http';
import { readSessionCookie, verifyToken } from '../lib/auth';
import { getSecret } from '../lib/secret';
import { DEFAULT_CONFIG, type Env, type GroupRow, type IconRow, type ConfigRow } from '../lib/schema';
import { WIDGET_KINDS, WIDGET_DEFAULT_COLOR, ICON_LIBRARY, WIDGET_VARIANTS } from '../lib/widgets';

function parseConfig(rows: ConfigRow[]): Record<string, unknown> {
  const map: Record<string, unknown> = { ...DEFAULT_CONFIG };
  for (const r of rows) {
    /* 内部键（以 _ 开头，如 app_setting 之外的系统键）绝不回传给前端，防止误泄露 */
    if (r.key.startsWith('_')) continue;
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

/** 访客页与后台同源，登录后浏览器会带上 sp_session，据此判断要不要放开全部内容 */
async function isLoggedIn(env: Env, req: Request): Promise<boolean> {
  const token = readSessionCookie(req);
  if (!token) return false;
  return (await verifyToken(token, await getSecret(env))) != null;
}

export async function publicPanel(env: Env, req: Request): Promise<Response> {
  const authed = await isLoggedIn(env, req);
  /* 未登录：只看「免登录可见」的分组；已登录：看全部未隐藏的 */
  const where = authed ? 'public_hide = 0' : 'public_hide = 0 AND public_show = 1';

  const [cfg, groups] = await Promise.all([
    env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>(),
    env.DB.prepare(`SELECT * FROM item_icon_group WHERE ${where} ORDER BY sort, id`).all<GroupRow>(),
  ]);
  const visible = groups.results.filter((g) => g.card_style !== 'hide');
  const ids = visible.map((g) => g.id);

  let icons: IconRow[] = [];
  if (ids.length) {
    icons = (await env.DB.prepare('SELECT * FROM item_icon WHERE group_id IN (' + ids.join(',') + ') ORDER BY sort, id').all<IconRow>()).results;
  }

  /* 组件外观配置按类型存（widget_cfg），一张卡片一行的那份 w_cfg 只作老数据的兜底：
     后台「组件管理」改的是类型级配置，放不放卡片都生效。 */
  const wcRows = await env.DB.prepare('SELECT kind, cfg FROM widget_cfg').all<{ kind: string; cfg: string }>();
  const cfgByKind = new Map(wcRows.results.map((r) => [r.kind, r.cfg || '']));

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
    authed,
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
        url: r.url || '',
        lanUrl: r.lan_url || '',
        description: r.description,
        iconType: r.icon_type,
        iconText: r.icon_text,
        iconUrl: (r.icon_type === 'r2' || r.icon_type === 'data') ? r.icon_url : '',
        iconName: r.icon_type === 'iconify' ? r.icon_name : '',
        color: r.background_color,
        openMethod: r.open_method,
        /* 内置组件标记：'link' 是普通卡片，其余（calendar/memo/todo）前台点开走组件面板 */
        kind: (r as { kind?: string }).kind || 'link',
        /* 组件外观/功能配置（JSON 字符串，前台自己解析）。普通卡片恒为空串；
           组件优先用类型级配置，取不到才回退这张卡自己存过的老配置 */
        wCfg: cfgByKind.get((r as { kind?: string }).kind || '') || (r as { w_cfg?: string }).w_cfg || '',
        sort: r.sort,
      })),
    })),
  });
}

export async function publicConfig(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT * FROM user_config').all<ConfigRow>();
  return json({ ok: true, config: parseConfig(rows.results) });
}

/**
 * 节假日 / 调休上班日：前台日历画「休 / 班」角标用。
 *
 * 数据量很小（一年几十条），一次全返回，用户翻到别的年份也不用再请求一次。
 * 不要求登录 —— 日历是公开组件，谁打开首页都要看到正确的放假安排。
 */
export async function publicCalDays(env: Env): Promise<Response> {
  const rows = await env.DB.prepare('SELECT day, kind FROM cal_day').all<{ day: string; kind: string }>();
  const days: Record<string, 'off' | 'work'> = {};
  for (const r of rows.results) days[r.day] = r.kind === 'work' ? 'work' : 'off';
  /* 不缓存：后台改完节假日，前台 syncFromAdmin 会立刻重拉，
     若这里给 max-age，浏览器会把旧值端上来，表现成「改完前台没变」 */
  return json({ ok: true, days }, { headers: { 'cache-control': 'no-store' } });
}

/**
 * 内置组件的元数据：图标库 + 风格列表 + 各组件的默认图标 + 功能开关定义 + 默认主色。
 *
 * 前台（渲染组件卡片和面板）与后台（组件管理页的图标选择器、开关列表）都从这里取，
 * 不各存一份 —— 同一份 SVG 路径写两处，改了必然有一边忘记，最后表现成
 * 「后台选的图标和前台显示的不一样」。这些内容不随用户数据变化，可放心缓存。
 */
export async function widgetMeta(): Promise<Response> {
  return json(
    {
      ok: true,
      defaultColor: WIDGET_DEFAULT_COLOR,
      kinds: WIDGET_KINDS,
      library: ICON_LIBRARY,
      variants: WIDGET_VARIANTS,
    },
    { headers: { 'cache-control': 'public, max-age=600' } },
  );
}
