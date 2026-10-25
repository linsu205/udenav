// 图标上传：直接转 base64 data URL 返回给前端，前端存到 item_icon.icon_url。
// 说明：原方案是上传到 R2 桶、/icons/* 从 R2 取。为避免部署时手动建 R2，
//      改成把图片当 base64 直接写进 D1 的 icon_url 字段（data:image/png;base64,...），
//      前端 <img src="..."> 天然支持 data URL，不需要单独拉取接口。
// 限制：单图 ≤ 256KB（data URL 编码会膨胀约 33%，D1 单条上限 2MB，留余量）。

import { bad } from '../lib/http';
import { type Env } from '../lib/schema';
import { getSession } from './admin';

const MAX_SIZE = 256 * 1024; // 256KB
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

export async function upload(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);

  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File)) return bad('请上传一个文件字段 file');
  if (file.size > MAX_SIZE) return bad('文件不能超过 256KB');
  if (!ALLOWED.has(file.type)) return bad('只支持 PNG / JPG / WebP / GIF / SVG');

  const buf = new Uint8Array(await file.arrayBuffer());
  const b64 = toBase64(buf);
  const dataUrl = `data:${file.type};base64,${b64}`;

  return json({ ok: true, icon_type: 'data', icon_url: dataUrl, size: file.size, by: s.username });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
}

function toBase64(buf: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(bin);
}
