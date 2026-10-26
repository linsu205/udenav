/**
 * 独立页入口（/admin）。
 * 内嵌到访客页时走的是同一个 bundle：访客页先置 window.__udenavEmbedded = true，
 * 再动态 import 本文件 —— 那时不碰主题、不删 boot 骨架，挂载点由弹窗提供。
 */
import { mountAdmin } from './mount';
import { applyTheme } from './lib/theme';

declare global {
  interface Window {
    __udenavEmbedded?: boolean;
  }
}

const embedded = window.__udenavEmbedded === true;

// 独立访问：先压深色，避免主题回来之前闪白
if (!embedded) applyTheme('dark');

const el = document.getElementById('adminRoot');
if (el) mountAdmin(el);

if (!embedded) document.getElementById('boot')?.remove();

export { mountAdmin, unmountAdmin } from './mount';
