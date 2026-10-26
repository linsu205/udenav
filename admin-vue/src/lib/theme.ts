/**
 * 后台主题 —— 跟随配置里的 theme 字段（'dark' | 'light'）
 *
 * 后台现在内嵌在访客页里，和访客页共用同一个 <html>。
 * 两边各自认一套标记：访客页的 CSS 用 data-theme，后台 theme.css 用 html.dark。
 * 所以这里必须同时写两个，否则会出现「后台已经变浅色、背后访客页还是深色」。
 *
 * 传空值直接不做事：配置还没拉回来时不要把访客页强行掰成深色。
 * （独立访问 /admin 的初始深色由 main.ts 显式调用 applyTheme('dark') 完成）
 */
export type Theme = 'dark' | 'light';

export function applyTheme(theme: string | null | undefined): void {
  if (theme !== 'dark' && theme !== 'light') return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.theme = theme;
}
