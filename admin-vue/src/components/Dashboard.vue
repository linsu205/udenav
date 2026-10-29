<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from '../store';
import { ElMessage } from 'element-plus';
import { Setting, FolderOpened, Files, TrendCharts, User, SwitchButton, ArrowRight, Picture, InfoFilled, Grid, Collection } from '@element-plus/icons-vue';
import { logoSrc } from '../lib/brand';
import ConfigPanel from './ConfigPanel.vue';
import GroupsPanel from './GroupsPanel.vue';
import WidgetsPanel from './WidgetsPanel.vue';
import ImagesPanel from './ImagesPanel.vue';
import IconsPanel from './IconsPanel.vue';
import BackupPanel from './BackupPanel.vue';
import StatsPanel from './StatsPanel.vue';
import UsersPanel from './UsersPanel.vue';
import AboutPanel from './AboutPanel.vue';

const store = useStore();
const active = ref(store.tab || 'config');

/* 侧栏图标不再一菜单一色（绿/橙/红/紫…散得很）；未选中走中性灰，
   选中统一品牌蓝 —— 颜色只在「当前在哪一页」这一件事上有含义 */
const menus = [
  { key: 'config', label: '页面配置', icon: Setting },
  { key: 'groups', label: '分组与卡片', icon: FolderOpened },
  { key: 'widgets', label: '组件管理', icon: Collection },
  { key: 'images', label: '图片管理', icon: Picture },
  { key: 'icons', label: '图标管理', icon: Grid },
  { key: 'backup', label: '备份与导入', icon: Files },
  { key: 'stats', label: '访问统计', icon: TrendCharts },
  { key: 'users', label: '用户管理', icon: User },
  { key: 'about', label: '关于', icon: InfoFilled },
];

/* 侧栏左上角：有自定义站点图标就用它，没有就用项目 logo（和关于页同一份） */
const sideLogo = computed(() => logoSrc(store.config?.favicon));

const current = computed(() => ({
  config: ConfigPanel, groups: GroupsPanel, widgets: WidgetsPanel, images: ImagesPanel, icons: IconsPanel, backup: BackupPanel,
  stats: StatsPanel, users: UsersPanel, about: AboutPanel,
}[active.value] || ConfigPanel));

async function logout() {
  await store.logout();
  ElMessage.success('已退出');
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
        <img class="logo-img" :src="sideLogo" alt="" />
        <span>UDeNav</span>
      </div>

      <nav class="menu">
        <button v-for="m in menus" :key="m.key" class="menu-item" :class="{ active: active === m.key }"
                @click="active = m.key; store.tab = m.key">
          <el-icon :size="17" :color="active === m.key ? 'var(--sp-accent)' : 'var(--sp-dim)'">
            <component :is="m.icon" />
          </el-icon>
          <span>{{ m.label }}</span>
        </button>
      </nav>

      <div class="side-foot">
        <button type="button" class="who" title="账号设置：头像 / 用户名 / 密码" @click="openAccount">
          <span class="who-avatar">
            <img v-if="store.user?.avatar" :src="store.user.avatar" alt="" />
            <template v-else>{{ (store.user?.username || '?').charAt(0).toUpperCase() }}</template>
          </span>
          <span class="who-name">{{ store.user?.username }}</span>
          <span class="who-tail">
            <span class="who-dot"></span>
            <el-icon class="who-go" :size="13"><ArrowRight /></el-icon>
          </span>
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
    font-size: 16px; font-weight: 700; letter-spacing: .2px;
    padding: 2px 8px 18px;
  }
  /* 左上角用项目真实 logo（蓝底 U+箭头），不再是绿色占位方块 */
  .logo-img {
    width: 24px; height: 24px; border-radius: 7px; flex: 0 0 24px;
    object-fit: cover; display: block;
    box-shadow: 0 2px 8px rgba(var(--sp-accent-rgb), .28);
  }
  .menu { display: flex; flex-direction: column; gap: 5px; flex: 1; }
  .menu-item {
    position: relative;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 13px; border: none; border-radius: 9px;
    background: transparent; color: var(--sp-dim);
    font-size: 13.5px; font-family: inherit; cursor: pointer;
    transition: background .15s, color .15s;
    text-align: left;
  }
  .menu-item:hover { background: var(--sp-card-in); color: var(--sp-text); }
  .menu-item.active {
    background: var(--sp-accent-soft);
    color: var(--sp-accent); font-weight: 600;
  }
  /* 左侧 3px 竖条：选中项在长列表里一眼可定位，比只换底色更清楚 */
  .menu-item.active::before {
    content: ''; position: absolute; left: 3px; top: 50%;
    width: 3px; height: 16px; margin-top: -8px; border-radius: 2px;
    background: var(--sp-accent);
  }

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
  .who:hover { background: var(--sp-hover); border-color: rgba(var(--sp-accent-rgb), .45); }
  .who:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 2px; }
  .who:active { transform: translateY(.5px); }
  .who-avatar {
    flex: 0 0 26px; width: 26px; height: 26px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12.5px; font-weight: 700; color: #fff;
    background: linear-gradient(135deg, #66b1ff, #337ecc);
    box-shadow: 0 2px 8px rgba(var(--sp-accent-rgb), .30);
    overflow: hidden;   /* 自定义头像要裁成圆形，避免方角露出 */
  }
  .who-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
  /* 在线状态点保留绿色：这是「在线/成功」语义，不是品牌色 */
  .who-dot {
    position: absolute; width: 6px; height: 6px; border-radius: 50%;
    background: var(--sp-ok);
    box-shadow: 0 0 0 3px rgba(var(--sp-ok-rgb), .14);
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
  /* overflow-x 用 clip 而不是 hidden：hidden 会让 .main 自己变成「滚动容器」，
     里面的 position:sticky 就只会相对它计算（而它根本不滚动）→ 吸顶彻底失效。
     clip 只裁剪、不建滚动容器，sticky 才能正确挂到外层 #adminRoot / html 上。
     先写 hidden 作兜底：老浏览器不认 clip 时退回原行为，只是不吸顶，不会坏布局。 */
  .main { flex: 1; min-width: 0; padding: 26px 30px 40px; overflow-x: hidden; overflow-x: clip; }

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
