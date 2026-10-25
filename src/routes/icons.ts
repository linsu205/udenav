// 图标上传（→ R2）与图标服务（先查缓存，未命中再回源 R2）
// 免费档每次请求最多 50 个子请求，所以图标不能一张一张直连 R2，必须走缓存。

import { bad, withCors } from '../lib/http';
import { type Env } from '../lib/schema';
import { getSession } from './admin';

const MAX_SIZE = 1024 * 1024; // 1MB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']);
const CACHE_DAYS = 30;
const CACHE_NAME = 'sp-icons-v1';

const extOf: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

export async function upload(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);

  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File)) return bad('请上传一个文件字段 file');
  if (file.size > MAX_SIZE) return bad('文件不能超过 1MB');
  if (!ALLOWED.has(file.type)) return bad('只支持 PNG / JPG / WebP / GIF / SVG / ICO');

  const key = `icons/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf[file.type] || 'bin'}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  await env.BUCKET.put(key, buf, { httpMetadata: { contentType: file.type } });

  return json({ ok: true, icon_type: 'r2', icon_url: '/icons/' + key, key, size: file.size, by: s.username });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

export async function serveIcon(env: Env, req: Request, key: string): Promise<Response> {
  if (!key || key.includes('..')) return bad('非法路径', 400);

  const cacheKey = new Request('https://icon-cache.local/' + key, { headers: { purpose: 'public' } });
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(req, new Response(hit.body, { headers: hit.headers }));

  const obj = await env.BUCKET.get(key);
  if (!obj) return bad('图标不存在', 404);

  const resp = new Response(obj.body, {
    status: 200,
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'content-length': String(obj.size),
      'cache-control': `public, max-age=${CACHE_DAYS * 86400}, immutable`,
    },
  });
  await cache.put(cacheKey, resp.clone());
  return withCors(req, resp);
}
