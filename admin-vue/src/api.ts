// 后端 API 封装
export async function api<T = any>(method: string, path: string, body?: any): Promise<T> {
  // 必须带 credentials: 'include'，否则跨域部署（前台页与 API 不同源）时浏览器
  // 不会把会话 Cookie（__Host-sp_session）随请求发出，导致登录后 me/loadAll 全部 401、
  // 「登录成功却几秒后退出登录」。同源部署下 same-origin 也会照常带 Cookie，无副作用。
  const opts: RequestInit = { method, credentials: 'include' };
  /* X-Requested-With: unav 是 CSRF 防护头：同源请求都带，跨站伪造请求带它会触发 CORS
     预检（预检只放行 content-type），自定义头被浏览器拦掉，伪造请求到不了后端。 */
  const headers: Record<string, string> = { 'x-requested-with': 'unav' };
  if (body && !(body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  opts.headers = headers;
  const r = await fetch(path, opts);
  let j: any = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) {
    /* 带上状态码，调用方才能区分「登录过期(401)」和普通错误 */
    const err = new Error((j && j.error) || ('HTTP ' + r.status)) as Error & { status?: number };
    err.status = r.status;
    /* 除登录接口外，任何 401 都说明会话没了 —— 统一广播一次，由 store 退回登录页。
       否则各个面板只会「一片空白」，看着像没有数据。 */
    if (r.status === 401 && !path.startsWith('/api/admin/login')) {
      window.dispatchEvent(new CustomEvent('udenav:unauthorized'));
    }
    throw err;
  }
  return j as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: any) => api<T>('POST', p, b);
export const put = <T = any>(p: string, b?: any) => api<T>('PUT', p, b);
export const patch = <T = any>(p: string, b?: any) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);
