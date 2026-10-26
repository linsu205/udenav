// 后端 API 封装
export async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method };
  if (body && !(body instanceof FormData)) {
    opts.headers = { 'content-type': 'application/json' };
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const r = await fetch(path, opts);
  let j: any = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
  return j as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: any) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b?: any) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b?: any) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);
