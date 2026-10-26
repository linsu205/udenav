<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from '../store';
import { ElMessage } from 'element-plus';
import { Setting, FolderOpened, Files, TrendCharts, Back, SwitchButton } from '@element-plus/icons-vue';
import ConfigPanel from './ConfigPanel.vue';
import GroupsPanel from './GroupsPanel.vue';
import BackupPanel from './BackupPanel.vue';
import StatsPanel from './StatsPanel.vue';

const store = useStore();
const active = ref(store.tab || 'config');

const menus = [
  { key: 'config', label: '页面配置', icon: Setting, color: '#2fbf6b' },
  { key: 'groups', label: '分组与卡片', icon: FolderOpened, color: '#e6a23c' },
  { key: 'backup', label: '备份与导入', icon: Files, color: '#409eff' },
  { key: 'stats', label: '访问统计', icon: TrendCharts, color: '#a78bfa' },
];

const current = computed(() => ({
  config: ConfigPanel, groups: GroupsPanel, backup: BackupPanel, stats: StatsPanel,
}[active.value] || ConfigPanel));

async function logout() {
  await store.logout();
  ElMessage.success('已退出');
}

function goHome() {
  if (window.self !== window.top) {
    window.top.postMessage({ type: 'udenav:close-modal' }, '*');
  } else {
    location.href = '/';
  }
}
</script>

<template>
  <div class="dash">
    <!-- 左侧菜单面板（sun-panel 风格） -->
    <aside class="side">
      <div class="side-logo">
        <span class="logo-dot"></span>
        <span>导航后台</span>
      </div>

      <nav class="menu">
        <button v-for="m in menus" :key="m.key" class="menu-item" :class="{ active: active === m.key }"
                @click="active = m.key; store.tab = m.key">
          <el-icon :size="17" :color="active === m.key ? m.color : '#8f99a3'">
            <component :is="m.icon" />
          </el-icon>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <div class="side-foot">
        <div class="who">
          <span class="who-name">{{ store.user?.username }}</span>
          <span class="who-role">{{ store.user?.role }}</span>
        </div>
        <button class="foot-btn" @click="goHome">
          <el-icon :size="14"><Back /></el-icon> 返回前台
        </button>
        <button class="foot-btn danger" @click="logout">
          <el-icon :size="14"><SwitchButton /></el-icon> 退出登录
        </button>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <main class="main">
      <component :is="current" />
    </main>
  </div>
</template>

<style scoped>
  .dash { display: flex; min-height: 100vh; background: var(--sp-bg); }

  /* 左侧 */
  .side {
    flex: 0 0 218px; display: flex; flex-direction: column;
    padding: 18px 14px 16px;
    background: var(--sp-panel);
    border-right: 1px solid rgba(255, 255, 255, .04);
    position: sticky; top: 0; height: 100vh; box-sizing: border-box;
  }
  .side-logo {
    display: flex; align-items: center; gap: 9px;
    font-size: 16px; font-weight: 700; letter-spacing: 1px;
    padding: 2px 8px 18px;
  }
  .logo-dot {
    width: 22px; height: 22px; border-radius: 7px; flex: 0 0 22px;
    background: linear-gradient(135deg, #2fbf6b, #1d8f4e);
    box-shadow: 0 2px 8px rgba(47, 191, 107, .35);
  }
  .menu { display: flex; flex-direction: column; gap: 5px; flex: 1; }
  .menu-item {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 13px; border: none; border-radius: 9px;
    background: transparent; color: #c3c9d0;
    font-size: 13.5px; font-family: inherit; cursor: pointer;
    transition: background .15s, color .15s;
    text-align: left;
  }
  .menu-item:hover { background: var(--sp-card-in); color: #e8eaed; }
  .menu-item.active { background: var(--sp-card-in); color: var(--sp-accent); font-weight: 600; }

  .side-foot { display: flex; flex-direction: column; gap: 7px; padding-top: 14px; }
  .who { padding: 0 6px 8px; display: flex; align-items: baseline; gap: 7px; }
  .who-name { color: var(--sp-text); font-size: 13px; font-weight: 600; }
  .who-role {
    font-size: 11px; color: var(--sp-accent);
    background: rgba(47, 191, 107, .1); border: 1px solid rgba(47, 191, 107, .3);
    padding: 0 7px; border-radius: 20px; line-height: 18px;
  }
  .foot-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 0; border-radius: 8px; font-size: 13px; font-family: inherit;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
    color: #c3c9d0; cursor: pointer; transition: all .15s;
  }
  .foot-btn:hover { background: var(--sp-hover); color: #fff; }
  .foot-btn.danger { color: #e8908f; border-color: rgba(245, 108, 108, .3); }
  .foot-btn.danger:hover { background: rgba(245, 108, 108, .12); border-color: rgba(245, 108, 108, .5); }

  /* 右侧 */
  .main { flex: 1; min-width: 0; padding: 26px 30px 40px; overflow-x: hidden; }

  @media (max-width: 768px) {
    .dash { flex-direction: column; }
    .side { position: static; height: auto; flex: none; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 10px; }
    .side-logo { padding: 0 8px; }
    .menu { flex-direction: row; flex-wrap: wrap; }
    .side-foot { flex-direction: row; padding-top: 0; margin-left: auto; }
    .who { display: none; }
    .foot-btn { padding: 7px 12px; }
    .main { padding: 18px 14px 30px; }
  }
</style>
