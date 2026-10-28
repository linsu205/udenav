/**
 * 站点标识（logo）
 *
 * 默认图标就是前台 <link id="fav" data-def> 里那一份 SVG：
 * #409EFF 圆角方 + 白色 U 形描边，右上角收成箭头 —— 这是项目自己的 logo。
 * 两处必须是同一份图形，改这里请同步 public/index.html 的 data-def。
 *
 * 页面配置里上传过 favicon 的，后台一律优先用它：关于页显示的就是「你现在这个站点的图标」，
 * 而不是写死的一张图。
 */
const BRAND_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>" +
  "<rect width='64' height='64' rx='16' fill='#409EFF'/>" +
  "<path d='M22 22 V36 Q22 46 32 46 Q42 46 42 36 V14' fill='none' stroke='#FFFFFF' stroke-width='7' stroke-linecap='round'/>" +
  "<path d='M34 22 L42 12 L50 22' fill='none' stroke='#FFFFFF' stroke-width='6' stroke-linecap='round' stroke-linejoin='round'/>" +
  '</svg>';

/** 默认 logo（data URI）。必须 encodeURIComponent：img 的 src 里裸 # 会被当成锚点 */
export const BRAND_LOGO = 'data:image/svg+xml,' + encodeURIComponent(BRAND_SVG);

/** 有自定义 favicon 用自定义，没有就退回项目 logo */
export function logoSrc(favicon?: string | null): string {
  const v = String(favicon || '').trim();
  return v || BRAND_LOGO;
}
