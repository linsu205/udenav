/**
 * 后台挂载器 —— 两种场景共用同一份代码：
 *   1) 独立访问 /admin  → main.ts 落到 #adminRoot 上
 *   2) 访客页弹窗内嵌    → public/index.html 动态 import 本包，自动挂到弹窗里的 #adminRoot
 *
 * 关于样式：CSS 在模块顶层 import，Vite 会抽成独立的 admin.[hash].css。
 * 独立成页时由 admin.html 的 <link> 引入；内嵌时访客页不经过构建，
 * 所以由它自己把同一个 <link> 插进 head（见 index.html 的 loadAdminAssets）。
 * 因此本模块里所有样式都必须以 #adminRoot 作用域（theme.css 已改造），
 * 否则会污染访客页。
 */
import { createApp, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/theme.css';
import App from './App.vue';
import EditApp from './EditApp.vue';

let instance: VueApp | null = null;
let observer: ResizeObserver | null = null;

/**
 * 把容器实测高度写进 --adm-h。
 * 后台原来用 100vh 撑满（.dash / .side / .sp-login / .booting），
 * 塞进弹窗后 100vh 会按整个窗口算，直接溢出。这里量一次 + 跟随尺寸变化。
 */
function syncHeight(el: HTMLElement): void {
  const write = () => {
    const h = el.clientHeight;
    if (h > 0) el.style.setProperty('--adm-h', `${h}px`);
  };
  write();
  if (typeof ResizeObserver !== 'undefined') {
    observer?.disconnect();
    observer = new ResizeObserver(write);
    observer.observe(el);
  }
}

export function mountAdmin(el: HTMLElement): VueApp {
  if (instance) return instance;
  el.classList.add('admin-scope');
  syncHeight(el);

  const app = createApp(App);
  app.use(createPinia());
  /* zIndex 起始值 2500：访客页的右键菜单(2100)/Tooltip(2400) 都在它下面，
     编辑弹窗的遮罩不会被它们穿透；后续下拉框、消息提示按同一管理器发号，自动更高 */
  app.use(ElementPlus, { size: 'default', zIndex: 2500 });
  app.mount(el);
  instance = app;
  return app;
}

export function unmountAdmin(): void {
  observer?.disconnect();
  observer = null;
  instance?.unmount();
  instance = null;
}

/* ---------- 独立卡片编辑弹窗（前台右键「编辑」） ---------- */

let editInstance: VueApp | null = null;
let editHost: HTMLElement | null = null;

/**
 * 在指定容器上单独挂一个「卡片编辑弹窗」Vue 实例。
 * 它和 mountAdmin 是两个互不相干的 app：容器不同、组件树不同，
 * 打开它不会创建后台面板的任何东西，所以后台不会闪。
 */
/* id 传 0 / 省略 = 新增（弹窗标题变「添加卡片」，保存走 POST） */
export function openItemEditor(el: HTMLElement, gid: number, id: number = 0): void {
  closeItemEditor();
  el.hidden = false;
  editHost = el;
  const app = createApp(EditApp, {
    gid,
    id,
    onDone: () => closeItemEditor(),
  });
  app.use(ElementPlus, { size: 'default', zIndex: 2500 });
  app.mount(el);
  editInstance = app;
}

export function closeItemEditor(): void {
  if (editInstance) {
    editInstance.unmount();
    editInstance = null;
  }
  if (editHost) {
    editHost.innerHTML = '';
    editHost.hidden = true;
    editHost = null;
  }
}
