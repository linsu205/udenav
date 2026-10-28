/* 在线图标（Iconify 名）的两份清单：常用 / 最近使用
   ------------------------------------------------------------
   都存在 localStorage，不进数据库：这是「这台浏览器上我怎么挑图标」的编辑习惯，
   不是站点配置。换台设备重新攒几条，比每保存一张卡片都写一次 config 表更划算。

   · 常用：自己手动收藏的，长期保留（上限 200，基本等于不限）
   · 最近：用过就自动记一条，新用的排最前，最多 100 条

   同步：同页多个组件（卡片弹窗 / 分组弹窗 / 图标管理页）靠自定义事件即时刷新；
        跨标签页由浏览器原生 storage 事件兜底。两份清单共用一个事件，谁变了都刷新。 */

export const RECENT_MAX = 100;
export const FAV_MAX = 200;
export const RECENT_KEY = 'udenav:recent-icons';
export const FAV_KEY = 'udenav:fav-icons';
const EVT = 'udenav:icon-lists';

/* 与后台 /api/icon 的白名单同一套规则：只接受 prefix:name，
   脏数据（手改过 localStorage、旧版本残留）在这里就被过滤掉，避免拿着垃圾名去请求代理 */
const NAME_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;

export function isIconName(n: string): boolean {
  return NAME_RE.test(String(n || '').trim());
}

export interface IconList {
  read: () => string[];
  push: (n: string) => string[];
  remove: (n: string) => string[];
  clear: () => void;
  has: (n: string) => boolean;
}

function makeList(key: string, max: number): IconList {
  const read = (): string[] => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is string => typeof x === 'string' && NAME_RE.test(x)).slice(0, max);
    } catch {
      return [];   // 存储被禁用 / 内容不是 JSON：当空列表处理，不影响弹窗正常使用
    }
  };

  const write = (list: string[]) => {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch { /* 隐私模式下写不进去，功能降级为「本次不记录」，不报错打断用户 */ }
    /* 同一个事件名广播：不论谁变了，页面上所有清单一起重读 */
    window.dispatchEvent(new CustomEvent(EVT));
  };

  const push = (name: string): string[] => {
    const n = String(name || '').trim();
    if (!NAME_RE.test(n)) return read();
    const list = read().filter((x) => x !== n);
    list.unshift(n);
    const out = list.slice(0, max);
    write(out);
    return out;
  };

  const remove = (name: string): string[] => {
    const out = read().filter((x) => x !== name);
    write(out);
    return out;
  };

  const watch = (fn: () => void): (() => void) => {
    const onLocal = () => fn();
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === RECENT_KEY || e.key === FAV_KEY) fn();
    };
    window.addEventListener(EVT, onLocal);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVT, onLocal);
      window.removeEventListener('storage', onStorage);
    };
  };

  return { read, push, remove, clear: () => write([]), has: (n) => read().includes(n), watch };
}

const recentList = makeList(RECENT_KEY, RECENT_MAX);
const favList = makeList(FAV_KEY, FAV_MAX);

/* ---------- 最近使用 ---------- */
export const readRecent = () => recentList.read();
export const pushRecent = (n: string) => recentList.push(n);
export const removeRecent = (n: string) => recentList.remove(n);
export const clearRecent = () => recentList.clear();

/* ---------- 常用 ---------- */
export const readFav = () => favList.read();
export const pushFav = (n: string) => favList.push(n);
export const removeFav = (n: string) => favList.remove(n);
export const clearFav = () => favList.clear();
export const isFav = (n: string) => favList.has(n);
/** 收藏 / 取消收藏，返回操作后的状态（true = 已加入常用） */
export function toggleFav(n: string): boolean {
  if (favList.has(n)) { favList.remove(n); return false; }
  favList.push(n);
  return true;
}

/** 订阅两份清单的变更（含跨标签页），返回取消订阅函数 */
export const watchIcons = (fn: () => void) => favList.watch(fn);

/* 常用图标库：卡片弹窗、分组弹窗、图标管理页三处共用一份，
   改地址只改这里（以前是弹窗里手写的五行 <a>，再加一处就得抄一遍） */
export interface IconLib { label: string; url: string; icon: string }
export const ICON_LIBS: IconLib[] = [
  { label: '全库搜索', url: 'https://icon-sets.iconify.design/', icon: 'ri:search-line' },
  { label: 'Remix Icon', url: 'https://icon-sets.iconify.design/ri/', icon: 'ri:remixicon-line' },
  { label: 'Material Design', url: 'https://icon-sets.iconify.design/mdi/', icon: 'mdi:material-design' },
  { label: 'Font Awesome', url: 'https://icon-sets.iconify.design/fa6-solid/', icon: 'fa6-brands:font-awesome' },
  { label: 'Tabler', url: 'https://icon-sets.iconify.design/tabler/', icon: 'tabler:brand-tabler' },
  { label: 'Solar', url: 'https://icon-sets.iconify.design/solar/', icon: 'solar:star-bold' },
];
