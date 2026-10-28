/**
 * 在线图标（iconify）的着色规则。
 *
 * 为什么需要它：iconify 单色图标的路径是 fill="currentColor"，但后台一律用 <img> 引用
 * /api/icon，SVG 是独立文档、继承不到页面的 color，只能落到初始值黑色 ——
 * 深色底板上就是「黑底黑图」，看着像一块黑方块。
 * 所以颜色必须在 URL 上带过去（服务端在根 <svg> 写 style="color:#xxx"）。
 *
 * 规则与底板文字色保持一致：
 * - 设了背景色：按亮度决定白/深，避免浅底上白图标看不见
 * - 没设背景色（玻璃底板）：暗色主题浅色，浅色主题深色
 */

/** 该背景色上应该用白图标还是深图标 */
export function readableOn(bg?: string | null): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(bg || '').trim());
  if (!m) return '#ffffff'; // rgba / 带 alpha 的串判断不了亮度，按深底处理
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.62 ? '#1f2328' : '#ffffff';
}

/** 后台当前是否暗色主题（theme.css 认 html.dark） */
function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** 图标颜色：hex（不带 #），可直接拼进 /api/icon?color= */
export function iconTint(bg?: string | null): string {
  const c = String(bg || '').trim();
  if (c) return readableOn(c).slice(1);
  return isDark() ? 'e8eaed' : '1f2328';
}

/** 拼 /api/icon 地址（name + 颜色），后台所有 <img> 都走这里 */
export function iconSrc(name: string, bg?: string | null): string {
  return `/api/icon?name=${encodeURIComponent(name)}&color=${iconTint(bg)}`;
}
