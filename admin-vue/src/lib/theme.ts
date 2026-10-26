/**
 * 后台主题开关 —— 跟随访客页配置里的 theme 字段（'dark' | 'light'）
 *
 * 两种打开方式：
 *  1. 独立访问 /admin  → 由 admin.html 里的内联脚本拉 /api/public/config 决定，
 *     登录后 store.loadAll 拿到配置再确认一次。
 *  2. 在访客页弹窗里打开 → 父页在 iframe load 后 postMessage 推送当前主题，
 *     访客页切主题时再推一次，实现后台实时跟随。
 *
 * 默认深色（与后端 DEFAULT_CONFIG.theme 一致），避免加载瞬间闪白。
 */
export type Theme = 'dark' | 'light';

const root = () => document.documentElement;

export function applyTheme(theme: string | null | undefined): void {
  root().classList.toggle('dark', (theme || 'dark') === 'dark');
}

/** 订阅访客页推过来的主题变更；返回注销函数 */
export function watchThemeFromParent(): () => void {
  const handler = (e: MessageEvent) => {
    if (e.data && e.data.type === 'udenav:theme' && typeof e.data.theme === 'string') {
      applyTheme(e.data.theme);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
