// 数据模型：表结构 + 首启建表 + 示例数据
// 模型对齐 sun-panel 原版（groups / item_icons / user_config），便于将来迁移。

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SECRET: string;
  /** Cloudflare Workers AI 绑定（wrangler.toml 里的 [ai]）：有它就能免密钥调用模型，不走公网 */
  AI?: Ai;
  SEED_DEMO?: string;
  ACCESS_AUD?: string;
  /** Cloudflare Access 团队域名（如 yourteam.cloudflareaccess.com），用于拉取验签公钥；
      只配 ACCESS_AUD 不配本项时，Access 校验退化为仅检查 aud/exp（边缘已鉴权）。 */
  ACCESS_TEAM_DOMAIN?: string;
  CORS_ORIGIN?: string;
};

// 图标类型：iconify（远程 iconify 名）| data（base64 data URL 内嵌图片）| color（首字母色块）
// 说明：'r2' 是历史值，DB 里可能残留，前端逻辑仍兼容；新写入一律用 'data'。
export type IconType = 'iconify' | 'r2' | 'data' | 'color';

export interface GroupRow {
  id: number;
  title: string;
  description: string;
  icon_type: IconType;
  icon_name: string;
  icon_url: string;
  sort: number;
  public_hide: number;
  /** 1 = 免登录可见；0 = 只有登录后才显示（默认） */
  public_show: number;
  card_style: string;
  created_by: number | null;
  created_at: number;
}

export interface IconRow {
  id: number;
  group_id: number;
  title: string;
  url: string;
  lan_url: string;
  icon_type: IconType;
  icon_text: string;
  icon_name: string;
  icon_url: string;
  description: string;
  open_method: number;
  background_color: string;
  /** 'link' 普通卡片（默认）| 'calendar' | 'memo' | 'todo' | 'conv' 内置组件 */
  kind: string;
  /** 组件外观/功能配置（JSON）：{ icon, color, opts }。见 lib/widgets.ts；空串 = 全用默认 */
  w_cfg: string;
  sort: number;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}

export interface ConfigRow {
  id: number;
  key: string;
  value: string;
  updated_at: number;
}

/* 数据模型版本：后台「关于」页会展示实际库里的值，方便核对「代码升级了、库没升」 */
export const SCHEMA_VERSION = '1.7';

/**
 * 节假日 / 调休上班的种子数据（2026 年法定节假日 + 周末统一休息）。
 *
 * 只用来初始化新库，之后完全由后台「组件管理 → 日历 → 节假日」维护 ——
 * 前台不再硬编码任何一年的安排，否则每年通知一发就要改代码、发版本。
 * off = 放假（画「休」角标），work = 调休上班（画「班」，覆盖周末红字，手动设置用）。
 * 默认周末一律算休息（不按国家调休），如需某周末补班，可在后台手动把那天标成「班」。
 */
const SEED_CAL_DAYS: Array<[string, string]> = (() => {
  const out: Array<[string, string]> = [];
  const ymd = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const span = (kind: string, from: string, to = from) => {
    const t = new Date(from + 'T00:00:00'), end = new Date(to + 'T00:00:00');
    for (; t <= end; t.setDate(t.getDate() + 1)) out.push([ymd(t), kind]);
  };
  /* 周末统一算休息日：不按国家调休，周六周日一律休（不再标「班」覆盖）。
     按「当前年份前后几年」滚动生成，不写死某一年，避免每年都要改代码。
     后台「组件管理 → 日历 → 节假日」仍可逐日调整，覆盖本种子。 */
  const y0 = new Date().getFullYear() - 1;
  for (let y = y0; y <= y0 + 6; y++) {
    const t = new Date(y, 0, 1), end = new Date(y, 11, 31);
    for (; t <= end; t.setDate(t.getDate() + 1)) {
      const wd = t.getDay();
      if (wd === 0 || wd === 6) out.push([ymd(t), 'off']);
    }
  }
  span('off', '2026-01-01', '2026-01-03');   // 元旦
  span('off', '2026-02-15', '2026-02-23');   // 春节
  span('off', '2026-04-04', '2026-04-06');   // 清明
  span('off', '2026-05-01', '2026-05-05');   // 劳动节
  span('off', '2026-06-19', '2026-06-21');   // 端午
  span('off', '2026-09-25', '2026-09-27');   // 中秋
  span('off', '2026-10-01', '2026-10-07');   // 国庆
  return out;
})();

export const DEFAULT_CONFIG = {
  logo_text: 'UDeNav',
  favicon: '',
  background_image: '',
  /* 壁纸库：多张壁纸（base64 或外链）。background_image 仍是「当前生效的那张」，
     两者保持一致即可；老数据没有此字段时前台自动回退到单张 background_image。 */
  backgrounds: [] as string[],
  /* 壁纸轮播：1=前台按 background_rotate_min 间隔（分钟，1~60）自动切换壁纸库图片（至少 2 张才生效）。
     老数据的 background_rotate_sec（秒）不再写库，前台与后台读取时按 sec/60 折算成分钟。 */
  background_rotate: 0,
  background_rotate_min: 5,
  background_blur: 2,
  background_mask: 0.2,
  margin_top: 14,
  margin_bottom: 6,
  /* 前台顶栏「管理后台」按钮的登录状态指示：1=已登录时图标染品牌蓝、未登录保持白色；
     0=不做状态区分，按钮始终是原来的白色（后台「个性化 → 登录状态」开关控制）。
     缺省按 1 处理，老数据没有这个键也能正常显示。 */
  login_state_color: 1,
  icon_style: 'info',
  search_box_show: 1,
  show_clock: 1,
  content_max_width: 1200,
  /* 宽度自适应档位：50/60/70/80 = 内容区按浏览器可视宽度的该百分比自适应（忽略 content_max_width）；
     0 = 关闭自适应，用固定 content_max_width。老数据里的 1 在前台/后台都按 80 折算，不用迁移数据库。
     后台改档位范围时 ConfigPanel 的 WIDTH_PCTS 要同步。 */
  content_width_auto: 0,
  /* 分组间距：访客页所有分组（.wrap .group）的 margin-top，后台可调 10~38；
     后台改默认值时 ConfigPanel.resetPersonalDefaults 要同步 */
  group_margin_top: 30,
  footer: '',
  theme: 'light',
  /* 图片上传策略（后台「图片管理 → 设置」可改，上传接口按此校验）：
     · image_allow_types：允许的 MIME 类型白名单
     · image_max_kb：单张上限（KB，上限后再乘 4/3 存成 base64）
     · image_quota_mb：图片总容量上限（MB，0 = 不限）；已用 + 这张超过即拒绝上传 */
  image_allow_types: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'] as string[],
  image_max_kb: 256,
  image_quota_mb: 20,
  search_engines: [
    { name: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: 'logo:search' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: 'ri:search-line' },
    { name: 'Google', url: 'https://www.google.com/search?q=%s', icon: 'ri:google-fill' },
  ],
} as const;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  pass_meta TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  /* 自定义头像：后台裁切成 256×256 的内嵌 base64 图片 URL，空串 = 用用户名首字母色块。
     注意本段 SQL 按分号切分执行，注释里不能出现分号（否则建表语句会被截断） */
  avatar TEXT NOT NULL DEFAULT '',
  failed_login INTEGER NOT NULL DEFAULT 0,
  lock_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS item_icon_group (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon_type TEXT NOT NULL DEFAULT 'iconify',
  icon_name TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  public_hide INTEGER NOT NULL DEFAULT 0,
  public_show INTEGER NOT NULL DEFAULT 0,
  card_style TEXT NOT NULL DEFAULT 'info',
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS item_icon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  lan_url TEXT NOT NULL DEFAULT '',
  icon_type TEXT NOT NULL DEFAULT 'color',
  icon_text TEXT NOT NULL DEFAULT '',
  icon_name TEXT NOT NULL DEFAULT '',
  icon_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  open_method INTEGER NOT NULL DEFAULT 2,
  background_color TEXT NOT NULL DEFAULT '#2a2a2a6b',
  kind TEXT NOT NULL DEFAULT 'link',
  /* 组件外观与功能配置（JSON）：图标变体 / 主色 / 功能开关。
     只有 kind != 'link' 的行会用它，普通卡片留空串，免得每行多存一份 {} */
  w_cfg TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

/* 内置组件（kind != 'link' 的卡片）的实例数据：备忘录正文、待办清单等。
   一张卡片对应一行，payload 是 JSON 字符串；组件本身仍是 item_icon 记录，
   所以分组、排序、拖拽、备份全部复用卡片那一套，不用另建体系。 */
CREATE TABLE IF NOT EXISTS widget_data (
  icon_id INTEGER PRIMARY KEY,
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

/* 内置组件的外观与功能配置，按「组件类型」存而不是按「卡片」存。
   为什么不用 item_icon.w_cfg：配置挂在卡片上时，组件没放到页面上就没有那一行，
   组件管理页只能显示「还没有添加组件」——等于「不放就不给管」。
   日历 / 备忘录 / 待办各一行，放不放卡片都能在这里设置图标、主色、描述、开关。 */
CREATE TABLE IF NOT EXISTS widget_cfg (
  kind TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cfg TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

/* 日历用到的法定节假日 / 调休上班日。一天一行，kind = off（休）| work（班）。
   单独建表而不是塞 user_config 大 JSON：后台是按年整年覆盖写的，
   用行记录可以直接 DELETE 掉某一年的全部再重插，不用先读-改-写一整坨。 */
CREATE TABLE IF NOT EXISTS cal_day (
  day TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'off',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS user_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS panel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

/* 系统级设置（键值）。和 user_config 的区别：这里放的是「不该随备份导出」的东西，
   例如 WebDAV 备份的账号密码——导出 JSON 若带上它，备份文件一旦外泄就等于泄露凭据。 */
CREATE TABLE IF NOT EXISTS app_setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS visit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  path TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS ix_icon_group ON item_icon_group(sort);
CREATE INDEX IF NOT EXISTS ix_icon_group_id ON item_icon(group_id, sort);
CREATE INDEX IF NOT EXISTS ix_visit_ts ON visit_log(ts);
`;

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    // 1) 幂等建表（IF NOT EXISTS，冷启动开销可忽略）
    //    注意：SQL 里表定义跨多行，必须按分号切分，不能按换行切分。
    //    语句前若写了 /* 注释 */，必须先剥掉再判断开头，否则这条建表会被静默丢掉
    //    （app_setting 就踩过这个坑：表一直没建出来，接口 500）
    const stmts = SCHEMA_SQL
      .split(';')
      .map((s) => s.replace(/^\s*\/\*[\s\S]*?\*\//g, '').trim())
      .filter((s) => s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX'))
      .map((s) => db.prepare(s));
    await db.batch(stmts);

    // 2) 首次冷启动或版本变更：写版本号 + 种子数据
    const row = await db.prepare('SELECT value FROM schema_meta WHERE key = ?').bind('version').first<{ value: string }>();
    if (row && row.value === SCHEMA_VERSION) return;

    // 版本迁移（只在新版本首次冷启动时跑一次）
    // 1.0 → 1.1：分组新增 public_show（1 = 免登录可见）
    // 1.1 → 1.2：卡片新增 icon_name（在线图标 Iconify 名）。此前只有分组有这一列，
    //             卡片选「在线图标」保存后图标名无处可存 → 表现为「保存不上」
    // 1.2 → 1.3：账号新增 avatar（自定义头像 data URL）
    // 1.3 → 1.4：卡片新增 kind（link 普通卡片 / calendar 日历 / memo 备忘录 / todo 待办），
    //             组件数据另存 widget_data 表
    // 1.4 → 1.5：卡片新增 w_cfg（组件图标变体 / 主色 / 功能开关，JSON）
    // 1.5 → 1.6：新增 cal_day 表（日历的法定放假 / 调休上班），并把 2026 年安排
    //             作为初始数据写进去 —— 之后完全由后台「组件管理 → 日历」维护
    // 1.6 → 1.7：新增 widget_cfg 表（组件外观/功能配置改为按类型存）。此前配置存在
    //             item_icon.w_cfg 上，组件没放到页面上就无处可存，组件管理页只能空着
    // 新库建表时已有该列，ALTER 会报 duplicate column，catch 掉即可
    await db
      .prepare('ALTER TABLE item_icon_group ADD COLUMN public_show INTEGER NOT NULL DEFAULT 0')
      .run()
      .catch(() => {});
    await db
      .prepare("ALTER TABLE item_icon ADD COLUMN icon_name TEXT NOT NULL DEFAULT ''")
      .run()
      .catch(() => {});
    await db
      .prepare("ALTER TABLE users ADD COLUMN avatar TEXT NOT NULL DEFAULT ''")
      .run()
      .catch(() => {});
    await db
      .prepare("ALTER TABLE item_icon ADD COLUMN kind TEXT NOT NULL DEFAULT 'link'")
      .run()
      .catch(() => {});
    await db
      .prepare("ALTER TABLE item_icon ADD COLUMN w_cfg TEXT NOT NULL DEFAULT ''")
      .run()
      .catch(() => {});

    /* 老配置搬家：以前每个组件的配置存在各自卡片的 w_cfg 上，现在统一到 widget_cfg。
       同类型有多张卡片时取最近改过的那一份（ORDER BY updated_at DESC，先插的优先，
       后面的主键冲突直接 IGNORE）。卡片上的 w_cfg 保留不删，前台仍拿它兜底。 */
    await db
      .prepare(
        `INSERT OR IGNORE INTO widget_cfg (kind, title, description, cfg, updated_at)
         SELECT kind, '', '', w_cfg, updated_at FROM item_icon
         WHERE kind IN ('calendar','memo','todo') AND w_cfg <> ''
         ORDER BY updated_at DESC`,
      )
      .run()
      .catch(() => {});

    /* 节假日种子：INSERT OR IGNORE，用户已经改过的日期不会被覆盖（主键是 day，
       同一天重复插入直接忽略）。只在版本升级时跑这一次。 */
    await db
      .batch(SEED_CAL_DAYS.map(([day, kind]) =>
        db.prepare('INSERT OR IGNORE INTO cal_day (day, kind) VALUES (?, ?)').bind(day, kind)))
      .catch(() => {});

    await db
      .prepare('INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)')
      .bind('version', SCHEMA_VERSION)
      .run();

    const cnt = await db.prepare('SELECT COUNT(*) AS n FROM item_icon_group').first<{ n: number }>();
    if (!cnt || cnt.n === 0) {
      await seedConfig(db);
      await seedDemo(db);
    }
  })();
  return ready;
}

async function seedConfig(db: D1Database): Promise<void> {
  const rows = Object.entries(DEFAULT_CONFIG).map(([key, value]) =>
    db.prepare('INSERT OR IGNORE INTO user_config (key, value) VALUES (?, ?)').bind(key, JSON.stringify(value)),
  );
  await db.batch(rows);
}

async function seedDemo(db: D1Database): Promise<void> {
  const groups: Array<[string, string, string]> = [
    ['常用', '每天要打开的', 'material-symbols:home'],
    ['工作', '办公与文档', 'material-symbols:work'],
    ['娱乐', '放松一下', 'material-symbols:movie'],
  ];
  const items: Array<[string, string, string, string, string]> = [
    ['常用', '百度', 'https://www.baidu.com', '#2932e1', '中文搜索'],
    ['常用', '哔哩哔哩', 'https://www.bilibili.com', '#fb7299', '弹幕视频'],
    ['常用', 'GitHub', 'https://github.com', '#24292e', '代码托管'],
    ['工作', 'QQ 邮箱', 'https://mail.qq.com', '#12b7f5', '收发邮件'],
    ['工作', '阿里云盘', 'https://www.aliyundrive.com', '#0066cc', '网盘'],
    ['娱乐', '网易云音乐', 'https://music.163.com', '#c20c0c', '在线音乐'],
  ];

  await db.batch(groups.map((g, i) => db.prepare('INSERT INTO item_icon_group (title, description, icon_name, sort) VALUES (?, ?, ?, ?)').bind(g[0], g[1], g[2], i * 100)));

  const ids = await db.prepare('SELECT id, title FROM item_icon_group ORDER BY sort').all<{ id: number; title: string }>();
  const idMap = new Map(ids.results.map((r) => [r.title, r.id]));
  let order = 0;
  const iconRows = items.map((it) =>
    db
      .prepare('INSERT INTO item_icon (group_id, title, url, background_color, description, open_method, sort) VALUES (?, ?, ?, ?, ?, 2, ?)')
      .bind(idMap.get(it[0])!, it[1], it[2], it[3], it[4], order++ * 10),
  );
  await db.batch(iconRows);
}
