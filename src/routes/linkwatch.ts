// 链接健康巡检：由 cron 每小时跑一小批，结果落 link_status，后台「分组与卡片」页直接读。
//
// 为什么不放在打开页面时查：卡片会慢慢腐烂（域名过期、改版 404、站点下线），
// 只有定期自动跑才发现得了；而随手打开后台时应该立刻能看到结论，不用等一轮。
//
// 为什么每轮只查一小批：Workers 免费档单请求子请求上限 50，全站一次扫会直接超。
// 每小时 20 条 → 一天 480 条，按「最久没查的优先」轮转，卡片再多也能慢慢覆盖。
//
// 判死规则：连续 3 次 bad 才在后台标红。偶发超时、反爬波动、站点临时维护
// 都只算一次坏，不该立刻让人以为链接死了。ok / warn 一律把连续失败清零。

import { json, readJson, numBody } from '../lib/http';
import { requireRole, isPrivateHost, fetchPage } from './admin';
import { probeLink } from './linkcheck';
import type { Env } from '../lib/schema';

const CFG_KEY = 'link_watch';
const LAST_KEY = 'link_watch_last';

/** 连续失败多少次才在后台标红 */
export const FAIL_STREAK_ALERT = 3;

export interface WatchCfg {
  enabled: boolean;    // 总开关：关掉就不再自动跑（手动「立即巡检」仍可用）
  batch: number;       // 每轮查多少条
  minAgeH: number;     // 同一张卡片最短重查间隔（小时）
  fixIcon: boolean;    // 顺手给「纯色块、没图标」的卡片补站点 favicon（默认关，避免改用户视觉）
  fixPerRun: number;   // 每轮最多补几张
}

const DFLT: WatchCfg = { enabled: true, batch: 20, minAgeH: 12, fixIcon: false, fixPerRun: 5 };

function normCfg(o: any): WatchCfg {
  const c: WatchCfg = {
    enabled: o?.enabled !== false,
    batch: Math.min(25, Math.max(1, Number(o?.batch) || DFLT.batch)),
    minAgeH: Math.min(72, Math.max(1, Number(o?.minAgeH) || DFLT.minAgeH)),
    fixIcon: o?.fixIcon === true,
    fixPerRun: Math.min(10, Math.max(0, Number(o?.fixPerRun ?? DFLT.fixPerRun))),
  };
  return c;
}

async function loadCfg(env: Env): Promise<WatchCfg> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?')
    .bind(CFG_KEY)
    .first<{ value: string }>();
  if (!row?.value) return { ...DFLT };
  try { return normCfg(JSON.parse(row.value)); } catch { return { ...DFLT }; }
}

async function saveCfg(env: Env, c: WatchCfg): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(CFG_KEY, JSON.stringify(c))
    .run();
}

interface LastRun { at: number; checked: number; bad: number }

async function loadLast(env: Env): Promise<LastRun> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?')
    .bind(LAST_KEY)
    .first<{ value: string }>();
  if (!row?.value) return { at: 0, checked: 0, bad: 0 };
  try {
    const o = JSON.parse(row.value);
    return { at: Number(o.at) || 0, checked: Number(o.checked) || 0, bad: Number(o.bad) || 0 };
  } catch { return { at: 0, checked: 0, bad: 0 }; }
}

/**
 * 跑一轮巡检。force=true 时忽略 enabled 开关（后台「立即巡检」用）。
 * 返回本轮实际检查条数，便于接口回话。
 */
export async function runWatch(env: Env, force = false): Promise<{ skipped: boolean; checked: number; bad: number; fixed: number }> {
  const cfg = await loadCfg(env);
  if (!cfg.enabled && !force) return { skipped: true, checked: 0, bad: 0, fixed: 0 };

  const now = Math.floor(Date.now() / 1000);
  const fresh = now - cfg.minAgeH * 3600;

  /* 只取「明确的 http(s) 地址」：填成 www.xx.com 那种后端探针会判格式错误，
     自动巡检不该把它记成坏链（用户看着像是站点挂了）。也没必要查内网的地址。
     卡片改过 URL 的立即重查，不必等满 minAgeH。 */
  const rows = await env.DB
    .prepare(
      `SELECT i.id, i.url
       FROM item_icon i
       LEFT JOIN link_status s ON s.icon_id = i.id
       WHERE (i.url LIKE 'http://%' OR i.url LIKE 'https://%')
         AND (s.checked_at IS NULL OR s.checked_at <= ? OR s.url <> i.url)
       ORDER BY COALESCE(s.checked_at, 0) ASC
       LIMIT ?`,
    )
    .bind(fresh, cfg.batch)
    .all<{ id: number; url: string }>();

  const list = rows.results || [];
  let checked = 0;
  let badCount = 0;

  if (list.length) {
    const results = await Promise.all(list.map(async (it) => {
      /* 内网/本机地址从 Workers 侧根本连不通，探了必然全红：直接记为「受限」，
         并写 checked_at 让它排到队尾，否则它每轮都会占掉一个名额形成饥饿 */
      let priv = false;
      try { priv = isPrivateHost(new URL(it.url).hostname); } catch { priv = false; }

      if (priv) {
        return {
          id: it.id, url: it.url, level: 'warn' as const, status: 0, ms: 0,
          error: '内网地址不做外网探测',
        };
      }
      const r = await probeLink(it.url);
      return { ...r, id: it.id, url: it.url };
    }));

    const stmts = results.map((r) => {
      if (r.level === 'bad') badCount++;
      return env.DB
        .prepare(
          `INSERT INTO link_status (icon_id, url, level, status, ms, error, fail_streak, checked_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(icon_id) DO UPDATE SET
             url = excluded.url,
             level = excluded.level,
             status = excluded.status,
             ms = excluded.ms,
             error = excluded.error,
             /* 只在 bad 时累加，ok/warn 归零 —— 连续失败才是「真挂了」的证据 */
             fail_streak = CASE WHEN excluded.level = 'bad' THEN link_status.fail_streak + 1 ELSE 0 END,
             checked_at = excluded.checked_at`,
        )
        .bind(r.id, r.url, r.level, r.status, r.ms, r.error || '', 0, now);
    });
    await env.DB.batch(stmts);
    checked = results.length;
  }

  /* 顺手补图标（默认关）：只碰「纯默认色块、连图标文字都没设」的卡片，
     用户自己设了色块/在线图标一律不动，免得覆盖他的视觉设计 */
  let fixed = 0;
  if (cfg.fixIcon && cfg.fixPerRun > 0) {
    const cand = await env.DB
      .prepare(
        `SELECT id, url FROM item_icon
         WHERE (url LIKE 'http://%' OR url LIKE 'https://%')
           AND icon_type = 'color' AND icon_url = '' AND icon_text = ''
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .bind(cfg.fixPerRun)
      .all<{ id: number; url: string }>();

    for (const it of cand.results || []) {
      try {
        if (isPrivateHost(new URL(it.url).hostname)) continue;
        const page = await fetchPage(it.url, { skipSizeCheck: true });
        if (!page.icon?.dataUrl) continue;
        await env.DB
          .prepare(
            `UPDATE item_icon SET icon_type = 'data', icon_url = ?, updated_at = strftime('%s','now')
             WHERE id = ?`,
          )
          .bind(page.icon.dataUrl, it.id)
          .run();
        fixed++;
      } catch { /* 单张失败不影响整轮 */ }
    }
  }

  /* 删掉已被删除卡片的孤儿行：JOIN 查询本来就过滤掉了它们，留着只是占地方 */
  await env.DB
    .prepare('DELETE FROM link_status WHERE icon_id NOT IN (SELECT id FROM item_icon)')
    .run()
    .catch(() => {});

  await env.DB
    .prepare(
      `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(LAST_KEY, JSON.stringify({ at: now, checked, bad: badCount }))
    .run()
    .catch(() => {});

  return { skipped: false, checked, bad: badCount, fixed };
}

/** cron 入口：失败只记日志，不能影响同批的备份任务 */
export async function scheduledLinkWatch(env: Env): Promise<void> {
  try {
    await runWatch(env);
  } catch (e) {
    console.error('[linkwatch] 巡检失败', e);
  }
}

/** GET /api/admin/link-status —— 巡检结果汇总 + 明细（前端直接拿去填列表色标） */
export async function linkStatus(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');

  const cfg = await loadCfg(env);
  const last = await loadLast(env);

  const rows = await env.DB
    .prepare(
      `SELECT s.icon_id, s.url, s.level, s.status, s.ms, s.error, s.fail_streak, s.checked_at,
              i.title, i.group_id
       FROM link_status s
       JOIN item_icon i ON i.id = s.icon_id
       ORDER BY (s.level = 'bad') DESC, s.fail_streak DESC, s.checked_at DESC`,
    )
    .all<any>();

  const items = (rows.results || []).map((r) => ({
    id: Number(r.icon_id),
    url: r.url,
    level: r.level,
    status: Number(r.status) || 0,
    ms: Number(r.ms) || 0,
    error: r.error || '',
    fail_streak: Number(r.fail_streak) || 0,
    checked_at: Number(r.checked_at) || 0,
    title: r.title || '',
    group_id: Number(r.group_id) || 0,
  }));

  /* 失效 = 连续失败达阈值；低于阈值的 bad 只是「待观察」，别吓人 */
  const failed = items.filter((x) => x.level === 'bad' && x.fail_streak >= FAIL_STREAK_ALERT);
  const watching = items.filter((x) => x.level === 'bad' && x.fail_streak < FAIL_STREAK_ALERT);

  const total = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM item_icon
       WHERE url LIKE 'http://%' OR url LIKE 'https://%'`,
    )
    .first<{ n: number }>();

  return json({
    ok: true,
    config: cfg,
    last,
    summary: {
      total: Number(total?.n) || 0,
      checked: items.length,
      failed: failed.length,
      watching: watching.length,
      ok: items.filter((x) => x.level === 'ok').length,
      warn: items.filter((x) => x.level === 'warn').length,
    },
    items,
  });
}

/** PUT /api/admin/link-status —— 改巡检配置 */
export async function putLinkStatusCfg(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const cur = await loadCfg(env);
  const next: WatchCfg = normCfg({
    enabled: body.enabled === undefined ? cur.enabled : body.enabled !== false,
    batch: numBody(body, 'batch', cur.batch, 1, 25),
    minAgeH: numBody(body, 'minAgeH', cur.minAgeH, 1, 72),
    fixIcon: body.fixIcon === undefined ? cur.fixIcon : body.fixIcon === true,
    fixPerRun: numBody(body, 'fixPerRun', cur.fixPerRun, 0, 10),
  });
  await saveCfg(env, next);
  return json({ ok: true, config: next });
}

/** POST /api/admin/link-status/run —— 立即巡检一轮（不等 cron） */
export async function runLinkStatusNow(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const r = await runWatch(env, true);
  return json({ ok: true, ...r });
}
