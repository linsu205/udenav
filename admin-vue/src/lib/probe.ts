/* 浏览器本机探测：判断「这个地址在用户这台机器上能不能打开」。
 *
 * 为什么不在 Worker 里查：Worker 出口在境外，国内站点普遍屏蔽境外 IP、WAF 拦非浏览器请求，
 * 于是「服务器侧连不上」和「链接真的坏了」混在一起，412/403/超时全被判成坏链。
 * 浏览器就坐在用户本机网络里，访问国内站点的路径与真实点击完全一致，结论天然更准。
 *
 * 代价是跨域拿不到状态码（no-cors 只能得到 opaque 响应），所以只输出两档：
 *   ok          —— 拿到了响应，任何状态码都算「能打开」（浏览器确实连上了）
 *   unreachable —— 网络层失败：域名解析不出来 / 连接被拒 / 超时 / 证书错误
 * 失败原因浏览器不给（统一是 TypeError: Failed to fetch），所以文案只陈述事实，不断言死链。
 *
 * 两个探测不了的情况单独标记，避免误报：
 *   1) http 目标 + https 页面 —— 混合内容，浏览器直接拦，与站点好坏无关
 *   2) 非 http(s) 地址
 */

export type ProbeLevel = 'ok' | 'unreachable' | 'skipped';

export interface ProbeResult {
  level: ProbeLevel;
  ms: number;
  why: string;
}

/* HEAD 优先：不下载正文，几十毫秒就能拿到响应头。
   少数站点/CDN 对 HEAD 直接断连（WAF 行为），所以失败后用 GET 再确认一次 —— 
   真死链会多花几秒，但能避免把「不支持 HEAD」误判成连不上。 */
const HEAD_MS = 5000;
const GET_MS = 4000;

/** 发一次 no-cors 请求，只要拿到响应就返回 true（不读 body、不看状态码） */
async function canReach(url: string, method: 'HEAD' | 'GET', ms: number): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    await fetch(url, {
      method,
      mode: 'no-cors',            // 不带它会被 CORS 拦；带了拿不到状态码，但我们只需要「通没通」
      redirect: 'follow',
      cache: 'no-store',          // 别拿缓存冒充可达：死链被缓存命中会一直显示正常
      credentials: 'omit',
      referrerPolicy: 'no-referrer', // 不把后台地址当来源发给目标站
      signal: ctrl.signal,
    });
    return true;
  } catch {
    /* 超时、拒绝连接、DNS 失败、证书错误、被拦截插件挡下，都只会走到这里且无法细分 */
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeInBrowser(raw: string): Promise<ProbeResult> {
  const url = (raw || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { level: 'skipped', ms: 0, why: '地址不是 http(s)，无法探测' };
  }
  /* https 页面里 fetch http 目标会被浏览器当混合内容拦掉，这时候「连不上」不代表站点有问题 */
  if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
    return { level: 'skipped', ms: 0, why: '本页是 https，浏览器不允许探测 http 地址' };
  }

  const t0 = performance.now();
  const ok = (await canReach(url, 'HEAD', HEAD_MS)) || (await canReach(url, 'GET', GET_MS));
  const ms = Math.round(performance.now() - t0);
  return ok
    ? { level: 'ok', ms, why: `本机访问正常（${ms} ms）` }
    : { level: 'unreachable', ms, why: '本机连不上：可能站点已停、也可能被网络环境或拦截插件挡住' };
}
