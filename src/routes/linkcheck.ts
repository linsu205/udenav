// 链接健康检查：后台「分组与卡片」里一键探测每张卡的外网地址。
//
// 为什么必须由 Worker 代请求：浏览器里 fetch 别的站点会被 CORS 拦住，读不到状态码；
// 而且从 Worker 出口访问更接近真实用户（同区域网络）。
//
// 只查外网 url —— 内网地址（192.168.x.x）在 Cloudflare 侧根本不可达，查了必然全红，没有意义。
// 每批最多 25 条：Workers 免费档单请求子请求上限 50，留一半余量给 D1 和其他调用。

import { json, bad, readJson } from '../lib/http';
import { requireRole } from './admin';
import type { Env } from '../lib/schema';

export type LinkLevel = 'ok' | 'warn' | 'bad';

export interface LinkResult {
  id: number;
  level: LinkLevel;
  status: number;      // HTTP 状态码，0 = 没拿到响应
  ms: number;          // 耗时
  error?: string;
}

const MAX_BATCH = 25;
const TIMEOUT_MS = 8000;

function levelOf(status: number): LinkLevel {
  if (status >= 200 && status < 400) return 'ok';
  /* 401/403/429：站点可达，只是挡了机器访问（反爬/需登录），对导航来说链接本身没问题 */
  if (status === 401 || status === 403 || status === 429) return 'warn';
  return 'bad';
}

/* 单条探测：后台手动检查与 cron 巡检共用（导出让 linkwatch 复用，别再复制一份） */
export async function probeLink(url: string): Promise<LinkResult> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const headers = {
    /* 不带 UA 很容易被大站直接 403，伪装成普通浏览器能减少误判 */
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  };
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal, headers });
    /* 不少站点不实现 HEAD（405/501），退回 GET；GET 只取响应头，不读 body */
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal, headers });
    }
    const status = r.status;
    return { id: 0, level: levelOf(status), status, ms: Date.now() - t0 };
  } catch (e: any) {
    const aborted = e?.name === 'AbortError';
    return {
      id: 0,
      level: 'bad',
      status: 0,
      ms: Date.now() - t0,
      error: aborted ? `超时（>${TIMEOUT_MS / 1000}s）` : (e?.message || '请求失败'),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** POST /api/admin/linkcheck  body: { items: [{ id, url }] } */
export async function linkCheck(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) return bad('没有要检查的链接');
  if (raw.length > MAX_BATCH) return bad(`一次最多检查 ${MAX_BATCH} 条，请分批提交`);

  const jobs = raw.map(async (it: any): Promise<LinkResult> => {
    const id = Number(it.id) || 0;
    const url = String(it.url || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      return { id, level: 'bad', status: 0, ms: 0, error: '地址格式不正确' };
    }
    const r = await probeLink(url);
    return { ...r, id };
  });

  const results = await Promise.all(jobs);
  return json({ ok: true, results });
}
