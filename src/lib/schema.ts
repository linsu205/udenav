// 数据模型：表结构 + 首启建表 + 示例数据
// 模型对齐 sun-panel 原版（groups / item_icons / user_config），便于将来迁移。

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SECRET: string;
  SEED_DEMO?: string;
  ACCESS_AUD?: string;
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
  icon_url: string;
  description: string;
  open_method: number;
  background_color: string;
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

const SCHEMA_VERSION = '1.0';

export const DEFAULT_CONFIG = {
  logo_text: 'udenav',
  background_image: '',
  background_blur: 10,
  background_mask: 0.2,
  margin_top: 6,
  margin_bottom: 6,
  icon_style: 'info',
  search_box_show: 1,
  footer: '',
  theme: 'dark',
  search_engines: [
    { name: 'Google', url: 'https://www.google.com/search?q=%s', icon: 'ri:google-fill' },
    { name: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: 'logo:search' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: 'ri:search-line' },
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
  icon_url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  open_method INTEGER NOT NULL DEFAULT 2,
  background_color TEXT NOT NULL DEFAULT '#2a2a2a6b',
  sort INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
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
    //    注意：SQL 里表定义跨多行，必须按分号切分，不能按换行切分
    const stmts = SCHEMA_SQL
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('CREATE TABLE') || s.startsWith('CREATE INDEX'))
      .map((s) => db.prepare(s));
    await db.batch(stmts);

    // 2) 首次冷启动或版本变更：写版本号 + 种子数据
    const row = await db.prepare('SELECT value FROM schema_meta WHERE key = ?').bind('version').first<{ value: string }>();
    if (row && row.value === SCHEMA_VERSION) return;
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
