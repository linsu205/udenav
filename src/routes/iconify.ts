// 在线图标代理：前台 / 后台不直接请求 api.iconify.design（避免跨域 + 国内访问不稳），
// 由 Worker 代取 SVG 再回吐，浏览器按 Cache-Control 缓存，过期由前台/后台 <img> 复用。
//
// 入参：?name=prefix:icon，如 ?name=akar-icons:github-fill
//       ?color=RRGGBB（可选）—— 见下方说明
// 出参：image/svg+xml（高度 64，默认 1:1 方图；宽图标按原始比例）
// 名称做白名单校验，只允许 [a-z0-9-] 的 prefix:name，杜绝任意 URL 直连。
//
// 为什么要 color 参数：iconify 的单色图标路径是 fill="currentColor"，直接当 <img src> 用时
// SVG 是独立文档，currentColor 继承不到页面颜色，只能落到初始值黑色 —— 深色底板上的图标
// 等于黑底黑图，看着就是一块黑方块。带上 color 后由服务端在根 <svg> 上写死 style="color:#xxx"
// 让内部的 currentColor 有值；多色图标不受影响（它们自己带 fill）。

const NAME_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;
const COLOR_RE = /^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/;

export async function iconifyProxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const name = url.searchParams.get('name')?.trim() || '';
  if (!NAME_RE.test(name)) return new Response('invalid icon name', { status: 400 });
  const color = (url.searchParams.get('color') || '').trim().replace(/^#/, '');
  const tint = COLOR_RE.test(color) ? color : '';

  const [prefix, icon] = name.split(':');
  const upstream = `https://api.iconify.design/${prefix}/${icon}.svg?height=64`;
  const r = await fetch(upstream, { cf: { cacheTtl: 86400 * 30, cacheEverything: true } });
  if (!r.ok) return new Response('icon not found', { status: 404 });

  let svg = await r.text();
  if (tint) {
    /* 在根 <svg> 上补 color；已经有 style 的话往里追加，避免出现两个 style 属性 */
    svg = svg.replace(/<svg\b[^>]*>/i, (tag) =>
      /style\s*=/i.test(tag)
        ? tag.replace(/style\s*=\s*"/i, `style="color:#${tint};`)
        : tag.replace(/>$/, ` style="color:#${tint}">`));
  }
  return new Response(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=2592000', // 30 天
    },
  });
}
