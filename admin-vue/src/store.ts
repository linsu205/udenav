import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { get, post } from './api';

export interface User { username: string; role: string; exp: number; }
export interface ConfigRow {
  logo_text: string; favicon?: string; background_image: string; background_blur: number; background_mask: number;
  margin_top: number; icon_style: string; search_box_show: number; footer: string; theme: string;
  search_engines: Array<{ name: string; url: string; icon?: string }>;
}
export interface Group {
  id: number; title: string; description: string; icon_type: string; icon_name: string;
  icon_url: string; sort: number; public_hide: number; card_style: string;
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

  const loggedIn = computed(() => !!user.value);

  async function checkLogin() {
    try {
      const r = await get<any>('/api/admin/me');
      if (r.logged_in) user.value = r;
    } catch { user.value = null; }
  }

  async function login(username: string, password: string) {
    const r = await post<any>('/api/admin/login', { username, password });
    user.value = r;
    return r;
  }

  async function register(username: string, password: string) {
    const r = await post<any>('/api/admin/register', { username, password });
    user.value = r;
    return r;
  }

  async function logout() {
    try { await post('/api/admin/logout'); } catch {}
    user.value = null;
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
    } finally {
      // 数据就绪后才关掉 loading，避免表单在 config 到达前挂载导致已保存的值不回填
      loading.value = false;
    }
  }

  return { user, config, groups, tab, loading, loggedIn, checkLogin, login, register, logout, loadAll };
});
