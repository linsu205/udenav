// 基础 HTTP 工具：JSON 响应、查询参数、请求体解析、CORS

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': 'self',
      'cache-control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

export function bad(msg: string, status = 400): Response {
  return json({ error: msg }, { status });
}

export function q(params: URLSearchParams, key: string): string {
  const v = params.get(key);
  return v == null ? '' : v;
}

export function num(params: URLSearchParams, key: string, dflt: number, min = -Infinity, max = Infinity): number {
  const raw = params.get(key);
  if (raw == null || raw === '') return dflt;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

/** 同 num()，但面向 JSON 请求体（键值对象）而不是 URLSearchParams */
export function numBody(body: Record<string, unknown>, key: string, dflt: number, min = -Infinity, max = Infinity): number {
  const raw = body?.[key];
  if (raw == null || raw === '') return dflt;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(n, min), max);
}

/** 解析 JSON 请求体；非法 JSON 抛带 httpStatus 的错误 */
export async function readJson(req: Request): Promise<any> {
  const text = await req.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpErr('请求体不是合法 JSON', 400);
  }
}

export function httpErr(msg: string, status: number): Error {
  const e = new Error(msg) as Error & { httpStatus?: number };
  e.httpStatus = status;
  return e;
}

/** 默认仅同源；需跨域时设 CORS_ORIGIN=http://your.domain */
export function withCors(req: Request, res: Response, corsOrigin?: string): Response {
  const origin = req.headers.get('origin');
  const headers = new Headers(res.headers);
  if (origin && corsOrigin && origin === corsOrigin) {
    // 跨域带凭据（Cookie）时，必须回显具体源 + 允许凭据；不能用 *，也不能漏掉这条
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('vary', 'origin');
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
