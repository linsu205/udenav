// 限流：单个 isolate 内存令牌桶
// 说明：Workers 是多实例运行，内存限流按实例计数，不是全局精确值。
// 对「只有自己用」的场景足够防误刷；要全局精确需要 KV/DO（免费额度也够，但没有必要）。

type Bucket = { n: number; t: number };

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

/**
 * @param key   限流键（IP + 路径分组）
 * @param limit 窗口内允许的请求数
 * @param windowSec 窗口长度（秒）
 * @returns 0 表示通过；>0 表示还需等多少秒
 */
export function allow(key: string, limit: number, windowSec: number): number {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) {
      if (now - b.t > windowSec * 1000) buckets.delete(k);
    }
    lastSweep = now;
  }
  const cur = buckets.get(key);
  if (!cur || now - cur.t > windowSec * 1000) {
    buckets.set(key, { n: 1, t: now });
    return 0;
  }
  if (cur.n >= limit) {
    return Math.ceil((cur.t + windowSec * 1000 - now) / 1000);
  }
  cur.n += 1;
  return 0;
}

export function ipOf(req: Request): string {
  const ip: unknown = (req.cf as { ip?: string } | undefined)?.ip;
  return typeof ip === 'string' ? ip.replace(/[^0-9.]/g, '') : 'unknown';
}
