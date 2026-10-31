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
 * 一个例外：页面是 https 时，http 目标属于混合内容，浏览器直接拦，探不到。
 * 但「点开跳转」是允许的，不能因此把人判成坏链 —— 这种改用公共 DoH 查域名：
 * 解析得出来就说明站点还在（判 ok），查不出来也不下结论（判 skipped，界面不显示标记）。
 * 注意绝不能用 DoH 反过来判死：有些域名只对特定 DNS 可见（企业内网出口就是典型），
 * 公共 DNS 查不到但用户点开照样能进。
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
const DOH_MS = 4000;

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

/* DoH 源：阿里解析国内域名又快又准，Cloudflare 兜底（两家都返回同样结构的 JSON，
   且都带了 Access-Control-Allow-Origin: *，浏览器里能直接读） */
const DOH = [
  'https://dns.alidns.com/resolve',
  'https://cloudflare-dns.com/dns-query',
];

/** 域名在公共 DNS 里能否解析：true 能 / false 明确不存在 / null 没查出来（换源也失败） */
async function dnsResolves(host: string): Promise<boolean | null> {
  for (const ep of DOH) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DOH_MS);
    try {
      const r = await fetch(`${ep}?name=${encodeURIComponent(host)}&type=A`, {
        headers: { accept: 'application/dns-json' },
        signal: ctrl.signal,
      });
      if (!r.ok) continue;
      const j: any = await r.json();
      if (j && j.Status === 0) return true;     // NOERROR
      if (j && j.Status === 3) return false;    // NXDOMAIN
      /* 其它状态（SERVFAIL / REFUSED 等）说明这台解析器答不上来，换下一个源 */
    } catch {
      /* 超时或被拦，换源 */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** 纯 IP / localhost 没法查 DNS，也不需要查 */
function isIpHost(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':') || host === 'localhost';
}

export async function probeInBrowser(raw: string): Promise<ProbeResult> {
  const url = (raw || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { level: 'skipped', ms: 0, why: '地址不是 http(s)，无法探测' };
  }
  let host = '';
  try { host = new URL(url).hostname; } catch { /* 交给下面按不可达处理 */ }

  /* https 页面里的 http 地址：混合内容，fetch 一律被拦。
     此时只查域名 —— 能解析就说明站点还在，点击跳转不受这条限制。 */
  if (location.protocol === 'https:' && /^http:\/\//i.test(url)) {
    if (!host || isIpHost(host)) {
      return { level: 'skipped', ms: 0, why: 'http 地址在本页无法直接探测（浏览器限制），点开确认即可' };
    }
    const t0 = performance.now();
    const alive = await dnsResolves(host);
    const ms = Math.round(performance.now() - t0);
    if (alive === true) {
      return { level: 'ok', ms, why: 'http 地址在本页探不了（浏览器混合内容限制），但域名解析正常，点击跳转可用' };
    }
    /* 查不到不代表坏：有些域名只对特定 DNS 可见，用户点开可能照样能进 */
    return { level: 'skipped', ms, why: 'http 地址在本页探不了（浏览器限制），域名在公共 DNS 也没查到，点开确认即可' };
  }

  const t0 = performance.now();
  const ok = (await canReach(url, 'HEAD', HEAD_MS)) || (await canReach(url, 'GET', GET_MS));
  const ms = Math.round(performance.now() - t0);
  return ok
    ? { level: 'ok', ms, why: `本机访问正常（${ms} ms）` }
    : { level: 'unreachable', ms, why: '本机连不上：可能站点已停、也可能被网络环境或拦截插件挡住' };
}
