/**
 * 后台改动 → 通知访客前台同步
 *
 * 后台现在直接挂在访客页的弹窗里，和前台是同一个文档，
 * 所以不再走跨 iframe 的 postMessage：访客页把自己的同步函数挂到 window 上，
 * 后台直接调用即可。
 *
 *   window.__udenavHome(target)  target='panel' 只重拉数据原地重渲染（默认，无感）
 *                               target='page'  整页刷新
 *   window.__udenavClose()      关掉弹窗回前台
 *
 * 独立访问 /admin 时没人接管，退回「刷新自己 / 回首页」。
 */
export type HomeTarget = 'panel' | 'page';

declare global {
  interface Window {
    __udenavHome?: (target: HomeTarget) => void;
    __udenavClose?: () => void;
  }
}

export function notifyHome(target: HomeTarget = 'panel'): void {
  if (typeof window.__udenavHome === 'function') {
    window.__udenavHome(target);
    return;
  }
  location.reload();
}

export function closeHome(): void {
  if (typeof window.__udenavClose === 'function') {
    window.__udenavClose();
    return;
  }
  location.href = '/';
}
