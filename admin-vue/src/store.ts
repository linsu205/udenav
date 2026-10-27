import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { get, post } from './api';

export interface User { username: string; role: string; exp: number; }
export interface ConfigRow {
  logo_text: string; favicon?: string; background_image: string; background_blur: number; background_mask: number;
  margin_top: number; icon_style: string; search_box_show: number; footer: string; theme: string;
  search_engines: Array<{ name: string; url: string; icon?: string }>;
}
export interface Group {
  id: number; title: string; description: string; icon_type: string; icon_name: string;
  icon_url: string; sort: number; public_hide: number; public_show: number; card_style: string;
  icon_count: number; items: IconItem[];
}
export interface IconItem {
  id: number; group_id: number; title: string; url: string; lan_url: string;
  icon_type: string; icon_text: string; icon_url: string; description: string;
  open_method: number; background_color: string; sort: number;
}

export const useStore = defineStore('udenav', () => {
  const user = ref<User | null>(null);
  const config = ref<ConfigRow | null>(null);
  const groups = ref<Group[]>([]);
  const tab = ref('config');
  const loading = ref(true);
  /* 仅当库里一个账号都没有时为 true —— 此时才允许注册（单租户，首个账号即唯一 owner） */
  const needSetup = ref(false);
  /* 侧栏账号卡被点击时自增，用户管理页据此把「自己那一行」高亮一下，
     让人一眼看到该改哪；纯 UI 信号，不参与持久化 */
  const usersHit = ref(0);
  /* 任何一个后台接口 401（会话过期 / 密码被改）都退回登录页，
     只提示一次，避免并发请求刷出一排相同 toast */
  let notifiedOut = false;
  if (typeof window !== 'undefined') {
    window.addEventListener('udenav:unauthorized', () => {
      user.value = null;
      if (notifiedOut) return;
      notifiedOut = true;
      ElMessage.warning('登录已过期，请重新登录');
      setTimeout(() => { notifiedOut = false; }, 3000);
    });
  }

  const loggedIn = computed(() => !!user.value);

  async function checkSetup() {
    try {
      const r = await get<any>('/api/admin/setup');
      needSetup.value = !!r.need_setup;
    } catch { needSetup.value = false; }
  }

  async function checkLogin() {
    try {
      const r = await get<any>('/api/admin/me');
      if (r.logged_in) user.value = r;
    } catch { user.value = null; }
  }

  /* 登录状态变了，访客页要根据新身份重拉内容（未登录只显示公开分组）。
     独立访问 /admin 时没人挂 __udenavHome，此时不做事，避免无谓刷新。 */
  function refreshHome() {
    if (typeof window.__udenavHome === 'function') window.__udenavHome('panel');
  }

  async function login(username: string, password: string) {
    const r = await post<any>('/api/admin/login', { username, password });
    user.value = r;
    refreshHome();
    return r;
  }

  async function register(username: string, password: string) {
    const r = await post<any>('/api/admin/register', { username, password });
    user.value = r;
    needSetup.value = false;   // 首个账号已建立，注册入口从此关闭
    refreshHome();
    return r;
  }

  async function logout() {
    try { await post('/api/admin/logout'); } catch {}
    user.value = null;
    await checkSetup();        // 退出后校准注册入口是否可见
    refreshHome();
  }

  async function loadAll() {
    try {
      const [c, g, i] = await Promise.all([
        get<any>('/api/admin/config'),
        get<any>('/api/admin/groups'),
        get<any>('/api/admin/icons'),
      ]);
      config.value = c.config;
      const icons: IconItem[] = i.icons || [];
      groups.value = (g.groups || []).map((gr: any) => ({
        ...gr,
        items: icons.filter(x => x.group_id === gr.id),
      }));
    } catch (e: any) {
      /* 401 由 api.ts 统一广播处理（退回登录页），这里别再弹第二条提示。
         其它错误以前是静默吞掉，分组页就一片空白，看着像「没有数据」。 */
      if (e?.status !== 401) ElMessage.error('数据加载失败：' + (e?.message || '未知错误'));
    } finally {
      // 数据就绪后才关掉 loading，避免表单在 config 到达前挂载导致已保存的值不回填
      loading.value = false;
    }
  }

  return { user, config, groups, tab, loading, needSetup, usersHit, loggedIn, checkSetup, checkLogin, login, register, logout, loadAll };
});
