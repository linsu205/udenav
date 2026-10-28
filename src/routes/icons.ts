// 图标 / 图片上传：直接转 base64 data URL 返回给前端，前端存到 icon_url / background_image 等字段。
// 说明：原方案是上传到 R2 桶、/icons/* 从 R2 取。为避免部署时手动建 R2，
//      改成把图片当 base64 直接写进 D1（data:image/png;base64,...），
//      前端 <img src="..."> 天然支持 data URL，不需要单独拉取接口。
// 限制：不再写死 —— 由「图片管理 → 设置」保存在 user_config 里的三项策略决定：
//      image_allow_types（类型白名单）/ image_max_kb（单张上限）/ image_quota_mb（图片总容量上限）。
//      data URL 编码会膨胀约 33%，所以容量按编码后的长度算，才是真正占 D1 的字节数。

import { bad } from '../lib/http';
import { DEFAULT_CONFIG, type Env } from '../lib/schema';
import { getSession } from './admin';

/** MIME → 给人看的短名；白名单里出现没收录的类型时退回 MIME 本身 */
const TYPE_LABEL: Record<string, string> = {
  'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WebP', 'image/gif': 'GIF',
  'image/svg+xml': 'SVG', 'image/x-icon': 'ICO', 'image/vnd.microsoft.icon': 'ICO',
  'image/bmp': 'BMP', 'image/avif': 'AVIF', 'image/jpg': 'JPG',
};
const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp', avif: 'image/avif',
};

const label = (mime: string) => TYPE_LABEL[mime] || mime;

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/** 读取上传策略（缺项 / 脏值一律回落到 DEFAULT_CONFIG，保证老库也能正常上传） */
async function policy(env: Env): Promise<{ types: string[]; maxKb: number; quotaMb: number }> {
  const rows = await env.DB
    .prepare(`SELECT key, value FROM user_config WHERE key IN ('image_allow_types', 'image_max_kb', 'image_quota_mb')`)
    .all<{ key: string; value: string }>();
  const m = new Map(rows.results.map((r) => [r.key, r.value]));
  const pick = <T>(k: string, d: T, ok: (v: unknown) => boolean): T => {
    try { const v = JSON.parse(m.get(k) ?? ''); return ok(v) ? (v as T) : d; } catch { return d; }
  };
  const types = pick<string[]>('image_allow_types', DEFAULT_CONFIG.image_allow_types as string[],
    (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string'));
  const maxKb = pick<number>('image_max_kb', DEFAULT_CONFIG.image_max_kb, (v) => typeof v === 'number' && v > 0);
  const quotaMb = pick<number>('image_quota_mb', DEFAULT_CONFIG.image_quota_mb, (v) => typeof v === 'number' && v >= 0);
  return { types, maxKb: Math.max(8, maxKb), quotaMb };
}

/** 已占用的图片字节数：卡片图标 + 站点配置里的内嵌图（外链不算）。
    分组图标只支持在线图标名（不占库），后台也没有上传入口，故不计入。 */
async function usedBytes(env: Env): Promise<number> {
  const row = await env.DB.prepare(`
    SELECT
      (SELECT COALESCE(SUM(LENGTH(CAST(icon_url AS BLOB))), 0) FROM item_icon WHERE icon_url LIKE 'data:%')
    + (SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) FROM user_config
       WHERE key IN ('background_image', 'favicon', 'backgrounds') AND value LIKE '%data:%') AS bytes
  `).first<{ bytes: number }>();
  return Number(row?.bytes) || 0;
}

/** 有些环境（旧浏览器 / 从资源管理器拖 SVG）给不出 file.type，用扩展名兜底 */
function mimeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_MIME[ext] || '';
}

export async function upload(env: Env, req: Request): Promise<Response> {
  const s = await getSession(env, req);
  if (!s) return bad('未登录', 401);

  const fd = await req.formData();
  const file = fd.get('file');
  if (!(file instanceof File)) return bad('请上传一个文件字段 file');

  const pol = await policy(env);
  const mime = mimeOf(file);

  // ① 类型
  if (!mime || !pol.types.includes(mime)) {
    const allow = pol.types.map(label).join(' / ');
    return bad(`不支持${mime ? ' ' + label(mime) + ' ' : ''}格式，当前允许：${allow}`);
  }
  // ② 单张大小
  if (file.size > pol.maxKb * 1024) {
    return bad(`单张图片不能超过 ${pol.maxKb} KB，这张是 ${fmtSize(file.size)}`);
  }

  const buf = new Uint8Array(await file.arrayBuffer());
  const b64 = toBase64(buf);
  const dataUrl = `data:${mime};base64,${b64}`;

  // ③ 总容量：按入库后的实际长度（base64 膨胀后）判断，超了直接拒绝
  if (pol.quotaMb > 0) {
    const cap = pol.quotaMb * 1024 * 1024;
    const used = await usedBytes(env);
    if (used + dataUrl.length > cap) {
      const left = Math.max(0, cap - used);
      return bad(`图片总容量已达上限 ${pol.quotaMb} MB，当前已用 ${fmtSize(used)}，剩余 ${fmtSize(left)}，`
        + `这张需要 ${fmtSize(dataUrl.length)}。请到「图片管理」删除不用的图片后再上传。`);
    }
  }

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
