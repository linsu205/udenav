/**
 * 后台改动 -> 通知访客前台同步
 *
 * 后台只在两种位置运行：
 *   1) 访客页弹窗里的 iframe -> 让父页重新拉取公开数据（不整页刷新：不闪屏、不丢滚动位置）
 *   2) 独立标签页打开的 /admin -> 只能刷新自己
 *
 * 前台是纯静态页，配置与分组都从 /api/public/panel 实时读取，
 * 所以「重新拉取一次」就等于按新设置刷新页面。
 */

/** 是否运行在 iframe 里（即访客页的弹窗内） */
export function inEmbedFrame(): boolean {
  try { return window.self !== window.top; } catch { return false; }
}

/**
 * @param target 'panel' = 只同步前台数据（默认，无感）；'page' = 让前台整页刷新
 */
export function notifyHome(target: 'panel' | 'page' = 'panel'): void {
  if (inEmbedFrame()) {
    const top = window.top;
    if (top) {
      try { top.postMessage({ type: target === 'page' ? 'udenav:refresh' : 'udenav:reload-panel' }, '*'); }
      catch { /* 跨域受限，忽略 */ }
    }
    return;
  }
  location.reload();
}
