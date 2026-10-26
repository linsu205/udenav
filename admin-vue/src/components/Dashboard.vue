<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from '../store';
import { ElMessage } from 'element-plus';
import { closeHome } from '../lib/notify';
import { Setting, FolderOpened, Files, TrendCharts, User, Back, SwitchButton, ArrowRight } from '@element-plus/icons-vue';
import ConfigPanel from './ConfigPanel.vue';
import GroupsPanel from './GroupsPanel.vue';
import BackupPanel from './BackupPanel.vue';
import StatsPanel from './StatsPanel.vue';
import UsersPanel from './UsersPanel.vue';

const store = useStore();
const active = ref(store.tab || 'config');

const menus = [
  { key: 'config', label: '页面配置', icon: Setting, color: '#2fbf6b' },
  { key: 'groups', label: '分组与卡片', icon: FolderOpened, color: '#e6a23c' },
  { key: 'backup', label: '备份与导入', icon: Files, color: '#409eff' },
  { key: 'stats', label: '访问统计', icon: TrendCharts, color: '#a78bfa' },
  { key: 'users', label: '用户管理', icon: User, color: '#f0a020' },
];

const current = computed(() => ({
  config: ConfigPanel, groups: GroupsPanel, backup: BackupPanel, stats: StatsPanel, users: UsersPanel,
}[active.value] || ConfigPanel));

async function logout() {
  await store.logout();
  ElMessage.success('已退出');
}

/* 返回前台：内嵌时由访客页关掉弹窗，独立访问时回首页 */
function goHome() {
  closeHome();
}

/* 点账号卡 = 去「用户管理」改自己的用户名 / 密码 */
function openAccount() {
  active.value = 'users';
  store.tab = 'users';
  store.usersHit++;   // 让用户管理页把自己那一行高亮一下，指明「改的是这里」
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
          <el-icon :size="17" :color="active === m.key ? m.color : 'var(--sp-dim)'">
            <component :is="m.icon" />
          </el-icon>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <div class="side-foot">
        <button type="button" class="who" title="账号设置：修改用户名 / 密码" @click="openAccount">
          <span class="who-avatar">{{ (store.user?.username || '?').charAt(0).toUpperCase() }}</span>
          <span class="who-name">{{ store.user?.username }}</span>
          <span class="who-tail">
            <span class="who-dot"></span>
            <el-icon class="who-go" :size="13"><ArrowRight /></el-icon>
          </span>
        </button>
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
  /* --adm-h：独立成页 = 视口高；内嵌弹窗 = 挂载容器实测高（mount.ts 写入） */
  .dash { display: flex; min-height: var(--adm-h, 100vh); background: var(--sp-bg); }

  /* 左侧 */
  .side {
    flex: 0 0 218px; display: flex; flex-direction: column;
    padding: 18px 14px 16px;
    background: var(--sp-panel);
    border-right: 1px solid var(--sp-card-border);
    position: sticky; top: 0; height: var(--adm-h, 100vh); box-sizing: border-box;
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
    background: transparent; color: var(--sp-dim);
    font-size: 13.5px; font-family: inherit; cursor: pointer;
    transition: background .15s, color .15s;
    text-align: left;
  }
  .menu-item:hover { background: var(--sp-card-in); color: var(--sp-text); }
  .menu-item.active { background: var(--sp-card-in); color: var(--sp-accent); font-weight: 600; }

  .side-foot { display: flex; flex-direction: column; gap: 7px; padding-top: 14px; }

  /* 账号卡：把裸文字收进一张小卡片，和上面两个按钮形成「身份 → 操作」的层次。
     整张卡是按钮，点了直接进「用户管理」。 */
  .who {
    display: flex; align-items: center; gap: 9px; width: 100%;
    padding: 7px 9px 7px 8px; margin-bottom: 3px;
    background: var(--sp-card-in);
    border: 1px solid var(--sp-card-border);
    border-radius: 10px;
    font-family: inherit; text-align: left; cursor: pointer;
    transition: background .15s, border-color .15s;
  }
  .who:hover { background: var(--sp-hover); border-color: rgba(47, 191, 107, .45); }
  .who:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 2px; }
  .who:active { transform: translateY(.5px); }
  .who-avatar {
    flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12.5px; font-weight: 700; color: #fff;
    background: linear-gradient(135deg, #2fbf6b, #1d8f4e);
    box-shadow: 0 2px 8px rgba(47, 191, 107, .28);
  }
  .who-name {
    flex: 1; min-width: 0;
    font-size: 13px; font-weight: 600; color: var(--sp-text); letter-spacing: .3px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* 尾部 14px 固定槽：默认显示登录状态点，悬停时原地换成「进入」箭头，不产生宽度跳动 */
  .who-tail {
    position: relative; flex: 0 0 14px; width: 14px; height: 14px;
    display: flex; align-items: center; justify-content: center;
  }
  .who-dot {
    position: absolute; width: 6px; height: 6px; border-radius: 50%;
    background: var(--sp-accent);
    box-shadow: 0 0 0 3px rgba(47, 191, 107, .14);
    transition: opacity .15s, transform .15s;
  }
  .who-go {
    position: absolute; color: var(--sp-accent);
    opacity: 0; transform: translateX(-3px);
    transition: opacity .15s, transform .15s;
  }
  .who:hover .who-dot { opacity: 0; transform: scale(.6); }
  .who:hover .who-go { opacity: 1; transform: translateX(0); }
  .foot-btn {
    display: flex; align-items: center; justify-content: center; gap: 6px;
    padding: 8px 0; border-radius: 8px; font-size: 13px; font-family: inherit;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
    color: var(--sp-dim); cursor: pointer; transition: all .15s;
  }
  .foot-btn:hover { background: var(--sp-hover); color: var(--sp-btn-fg); }
  .foot-btn.danger { color: var(--sp-danger-text); border-color: rgba(245, 108, 108, .3); }
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
