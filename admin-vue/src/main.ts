/**
 * 独立页入口（/admin）。
 * 内嵌到访客页时走的是同一个 bundle：访客页先置 window.__udenavEmbedded = true，
 * 再动态 import 本文件 —— 那时不碰主题、不删 boot 骨架，挂载点由弹窗提供。
 */
import { mountAdmin, unmountAdmin, openItemEditor, closeItemEditor } from './mount';
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
/* 独立页 /admin：挂载点就在本页，直接挂。
   内嵌到访客页时不自动挂 —— 访客页可能在「只开编辑弹窗」，那时
   后台面板一个实例都不该被创建（否则又会出现闪一下的问题）。
   它需要后台时会显式调 mountAdmin()。 */
if (el && !embedded) mountAdmin(el);

if (!embedded) document.getElementById('boot')?.remove();

/* 内嵌到访客页时，由访客页决定要什么：完整后台面板，还是只开一张卡的编辑弹窗。
   构建产物这边不一定保留 ES 命名导出（Vite 会把入口包成单文件），
   所以直接挂到 window 上，访客页取用最稳。 */
(window as any).__udenavAdmin = { mountAdmin, unmountAdmin, openItemEditor, closeItemEditor };
