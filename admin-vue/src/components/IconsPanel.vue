<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Search, Close, Delete, Plus } from '@element-plus/icons-vue';
import IIcon from './IIcon.vue';
import {
  RECENT_MAX, FAV_MAX, ICON_LIBS, isIconName,
  readRecent, readFav, watchIcons, removeRecent, clearRecent,
  removeFav, pushFav, clearFav,
} from '../lib/icon-lists';

/* 图标管理：常用（自己收藏）+ 最近使用（自动记录）两份清单。
   数据全部来自 localStorage（见 lib/icon-lists.ts），本页只做四件事：
   收（粘贴名字加入常用）、找（搜索 + 按图标库筛）、拿（点一下复制名字）、清。 */

const tab = ref<'fav' | 'recent'>('recent');
const recent = ref<string[]>(readRecent());
const fav = ref<string[]>(readFav());
const q = ref('');
const prefix = ref('');
const draft = ref('');
const hot = ref('');            // 刚复制的那一格，短暂高亮一下给出反馈
let hotTimer = 0;

const stop = watchIcons(() => {
  recent.value = readRecent();
  fav.value = readFav();
});
onBeforeUnmount(() => { stop(); clearTimeout(hotTimer); });

const list = computed(() => (tab.value === 'fav' ? fav.value : recent.value));
const limit = computed(() => (tab.value === 'fav' ? FAV_MAX : RECENT_MAX));
/* 最近那页每格都要判断「是否已收藏」：算一次 Set，别在模板里对 100 个格子各读一遍 localStorage */
const favSet = computed(() => new Set(fav.value));

/* 前缀 = 图标库（ri / mdi / solar…），按用量排序：用得多的库排前面，一点就筛出来 */
const prefixes = computed(() => {
  const m = new Map<string, number>();
  for (const n of list.value) {
    const p = n.split(':')[0];
    m.set(p, (m.get(p) || 0) + 1);
  }
  return [...m.entries()]
    .map(([p, n]) => ({ p, n }))
    .sort((a, b) => b.n - a.n || a.p.localeCompare(b.p));
});

const shown = computed(() => {
  const k = q.value.trim().toLowerCase();
  return list.value.filter((n) =>
    (!prefix.value || n.startsWith(prefix.value + ':')) &&
    (!k || n.toLowerCase().includes(k)));
});

/* 切 tab 时把筛选条件清掉：在「最近」里筛了 ri，切到「常用」还留着会看到一片空 */
function switchTab(t: 'fav' | 'recent') {
  tab.value = t;
  q.value = '';
  prefix.value = '';
}

async function copy(n: string) {
  /* 图标名要贴到别处用，优先走剪贴板 API；非 https / 旧浏览器回落到临时 textarea */
  try {
    await navigator.clipboard.writeText(n);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = n;
    ta.select();
    document.body.appendChild(ta);
    document.execCommand('copy');
    ta.remove();
  }
  hot.value = n;
  clearTimeout(hotTimer);
  hotTimer = window.setTimeout(() => { hot.value = ''; }, 1000);
  ElMessage.success({ message: '已复制 ' + n, duration: 1400 });
}

/* 常用：加 / 减 */
function addFav() {
  const n = draft.value.trim();
  if (!n) return;
  if (!isIconName(n)) {
    ElMessage.warning('格式应为「前缀:图标名」，如 ri:home-fill');
    return;
  }
  if (favSet.value.has(n)) {
    ElMessage.info('这个图标已经在常用里了');
    return;
  }
  pushFav(n);
  draft.value = '';
  ElMessage.success('已加入常用');
}

function toggleStar(n: string) {
  if (favSet.value.has(n)) {
    removeFav(n);
    ElMessage.success('已从常用移除');
  } else {
    pushFav(n);
    ElMessage.success('已加入常用');
  }
}

function drop(n: string) {
  if (tab.value === 'fav') {
    removeFav(n);
    ElMessage.success('已移出常用');
  } else {
    removeRecent(n);
    ElMessage.success('已从最近列表移除');
  }
}

async function clearAll() {
  const isFavTab = tab.value === 'fav';
  try {
    await ElMessageBox.confirm(
      isFavTab
        ? `清空后这 ${fav.value.length} 个常用图标都会消失（最近使用不受影响）。站点配置和卡片图标不受影响。`
        : `清空后这 ${recent.value.length} 条记录都会消失，之后再用图标会重新开始记录（常用不受影响）。站点配置和卡片图标不受影响。`,
      isFavTab ? '清空常用' : '清空最近使用',
      { type: 'warning', confirmButtonText: '清空', cancelButtonText: '取消', lockScroll: false },
    );
  } catch { return; }
  if (isFavTab) clearFav(); else clearRecent();
  q.value = '';
  prefix.value = '';
  ElMessage.success('已清空');
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>图标管理</h2>
        <div class="sub">常用（自己收藏）与最近用过的在线图标（Iconify 名）· 点一下复制名称</div>
      </div>
      <div class="head-right">
        <el-button :disabled="!list.length" @click="clearAll">
          <el-icon class="btn-ico"><Delete /></el-icon>{{ tab === 'fav' ? '清空常用' : '清空记录' }}
        </el-button>
      </div>
    </div>

    <!-- 两个清单：常用靠手动收藏，最近按使用顺序自动累积 -->
    <div class="tabs">
      <button type="button" class="tab" :class="{ on: tab === 'fav' }" @click="switchTab('fav')">
        <IIcon name="ri:star-line" :size="14" />常用<b>{{ fav.length }}</b>
      </button>
      <button type="button" class="tab" :class="{ on: tab === 'recent' }" @click="switchTab('recent')">
        <IIcon name="ri:history-line" :size="14" />最近使用<b>{{ recent.length }}</b>
      </button>
      <span class="tabs-count">已记录 {{ list.length }} / {{ limit }}</span>
    </div>

    <!-- 常用：手动添加入口（粘贴 Iconify 名即可，保存前先校验格式） -->
    <div v-if="tab === 'fav'" class="add-row">
      <el-input
        v-model="draft" class="add-input" clearable :prefix-icon="Plus"
        placeholder="粘贴 Iconify 名加入常用，如 ri:home-fill"
        @keyup.enter="addFav"
      />
      <el-button type="primary" :disabled="!draft.trim()" @click="addFav">加入常用</el-button>
      <span class="add-tip">格式 <code>前缀:图标名</code>，名字可以到下面的常用图标库里复制</span>
    </div>

    <!-- 工具条：左搜索 + 图标库筛选。这个清单为空时整行不渲染，
         免得空白页上挂着一个没用的搜索框和一个孤零零的「全部 0」 -->
    <div class="bar" v-if="list.length">
      <el-input
        v-model="q" class="q" placeholder="搜索图标名，如 solar:star"
        clearable :prefix-icon="Search"
      />
      <div class="chips">
        <button type="button" class="chip" :class="{ on: prefix === '' }" @click="prefix = ''">
          全部<span class="chip-n">{{ list.length }}</span>
        </button>
        <button
          v-for="p in prefixes" :key="p.p" type="button" class="chip"
          :class="{ on: prefix === p.p }" @click="prefix = prefix === p.p ? '' : p.p"
        >
          {{ p.p }}<span class="chip-n">{{ p.n }}</span>
        </button>
      </div>
    </div>

    <!-- 空态：分别告诉用户「常用怎么来」和「最近怎么来」 -->
    <div v-if="!list.length" class="empty">
      <div class="empty-ico"><IIcon :name="tab === 'fav' ? 'ri:star-line' : 'ri:apps-2-line'" :size="22" /></div>
      <div class="empty-t">{{ tab === 'fav' ? '常用里还没有图标' : '还没有记录过在线图标' }}</div>
      <div class="empty-s">
        <template v-if="tab === 'fav'">
          在上面粘贴 Iconify 名（如 <b>ri:home-fill</b>）加入常用；也可以在「最近使用」里悬停图标点 ☆ 收藏，
          或直接编辑卡片 / 分组时在图标选择器里收藏。常用会长期保留，不会因为清理最近记录而消失。
        </template>
        <template v-else>
          在「分组与卡片」里把卡片的图标风格切到<b>在线图标</b>，填入 Iconify 名并保存，用过的名字就会自动排在这里，
          下次编辑时点输入框右侧的按钮即可直接选。
        </template>
      </div>
    </div>

    <template v-else>
      <el-empty v-if="!shown.length" description="没有匹配的图标，换个关键词或切回「全部」" />
      <div v-else class="grid">
        <div v-for="n in shown" :key="n" class="cell" :class="{ hot: hot === n }">
          <button type="button" class="cell-hit" :title="n + ' —— 点击复制'" @click="copy(n)">
            <span class="tile"><IIcon :name="n" :size="16" /></span>
            <span class="nm">{{ n }}</span>
          </button>
          <div class="cell-ops">
            <!-- 最近里可以直接收藏进常用；已有收藏时实心★提示，再点即取消 -->
            <button
              v-if="tab === 'recent'" type="button" class="mini" :class="{ star: favSet.has(n) }"
              :title="favSet.has(n) ? '已在常用（点击取消）' : '加入常用'" @click.stop="toggleStar(n)"
            >
              <IIcon :name="favSet.has(n) ? 'ri:star-fill' : 'ri:star-line'" :size="11" />
            </button>
            <button
              type="button" class="mini x"
              :title="tab === 'fav' ? '移出常用' : '从最近列表移除'" @click.stop="drop(n)"
            >
              <el-icon :size="11"><Close /></el-icon>
            </button>
          </div>
        </div>
      </div>
      <div class="grid-tip">
        显示 {{ shown.length }} 条<span v-if="shown.length !== list.length">（共 {{ list.length }} 条）</span> ·
        点格子复制图标名，粘贴到卡片 / 分组的在线图标输入框<span v-if="tab === 'recent'">，点 ☆ 收进常用</span>
      </div>
    </template>

    <!-- 常用图标库：与卡片 / 分组弹窗里那一行是同一份数据、同一个样式（lib/icon-lists.ts 的 ICON_LIBS），
         一行轻量文字链接就够 —— 开新窗口去站内搜名字，不需要卡片那么重的形态 -->
    <div class="libs">
      <div class="libs-row">
        <span class="libs-label"><IIcon name="ri:book-2-line" :size="13" />常用图标库：</span>
        <a v-for="l in ICON_LIBS" :key="l.url" class="lib-link" :href="l.url" target="_blank" rel="noopener">
          {{ l.label }}
        </a>
      </div>
      <div class="lib-tip">
        在图标库里复制名字（形如 <code>ri:home-fill</code>）填进卡片 / 分组即可；后台会通过
        <code>/api/icon</code> 代理取图，前台不直连 Iconify。
      </div>
    </div>
  </div>
</template>

<style scoped>
  .head-right { display: flex; align-items: center; gap: 10px; }
  .btn-ico { margin-right: 5px; }

  /* 两个清单的分段切换 */
  .tabs {
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 14px;
  }
  .tab {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 14px; border-radius: 9px; cursor: pointer;
    font-size: 13px; font-family: inherit;
    color: var(--sp-dim); background: var(--sp-card);
    border: 1px solid var(--sp-card-border);
    transition: color .15s, background .15s, border-color .15s;
  }
  .tab:hover { color: var(--sp-text); border-color: var(--sp-border-hover); }
  .tab.on {
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .45); font-weight: 600;
  }
  .tab b {
    font-weight: 500; font-size: 11px; color: var(--sp-faint);
    font-variant-numeric: tabular-nums;
  }
  .tab.on b { color: var(--sp-accent); opacity: .75; }
  .tabs-count {
    margin-left: auto; font-size: 12.5px; color: var(--sp-faint);
    font-variant-numeric: tabular-nums;
  }

  /* 常用：添加入口（与工具条同为卡片形态，虚线边提示「往里填名字」） */
  .add-row {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 10px 12px; margin-bottom: 12px;
    border-radius: 10px;
    background: var(--sp-card); border: 1px dashed var(--sp-border);
  }
  .add-input { width: 300px; }
  .add-tip { font-size: 12px; color: var(--sp-faint); }
  .add-tip code, .lib code {
    padding: 1px 5px; border-radius: 5px; font-size: 11.5px;
    color: var(--sp-accent); background: var(--sp-accent-soft);
  }

  .bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    padding: 10px 12px; margin-bottom: 14px;
    background: var(--sp-card); border: 1px solid var(--sp-card-border);
    border-radius: 10px;
  }
  .q { width: 240px; }
  .chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 11px; border-radius: 8px; cursor: pointer;
    font-size: 12.5px; font-family: inherit;
    color: var(--sp-dim); background: var(--sp-card-in);
    border: 1px solid var(--sp-border);
    transition: color .15s, background .15s, border-color .15s;
  }
  .chip:hover { color: var(--sp-text); border-color: var(--sp-border-hover); }
  .chip.on {
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .45); font-weight: 600;
  }
  .chip-n {
    font-size: 11px; color: var(--sp-faint); font-variant-numeric: tabular-nums;
  }
  .chip.on .chip-n { color: var(--sp-accent); opacity: .8; }

  /* 图标格：图标在上、名字在下，悬停浮起 + 右上出操作按钮 */
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 10px;
  }
  .cell {
    position: relative;
    background: var(--sp-card); border: 1px solid var(--sp-card-border);
    border-radius: 11px;
    transition: transform .15s, box-shadow .15s, border-color .15s;
  }
  .cell:hover {
    transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, .14);
    border-color: rgba(var(--sp-accent-rgb), .42);
  }
  .cell.hot { border-color: var(--sp-ok); }
  .cell-hit {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    width: 100%; padding: 13px 9px 10px; cursor: pointer;
    background: transparent; border: 0; border-radius: inherit;
    font-family: inherit;
  }
  .cell-hit:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 2px; }
  .tile {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 9px;
    color: var(--sp-dim); background: var(--sp-card-in);
    transition: color .15s, background .15s;
  }
  .cell:hover .tile { color: var(--sp-accent); background: var(--sp-accent-soft); }
  .cell.hot .tile { color: var(--sp-ok); background: rgba(var(--sp-ok-rgb), .12); }
  .nm {
    max-width: 100%;
    font-size: 11px; line-height: 1.3; color: var(--sp-dim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cell:hover .nm { color: var(--sp-text); }

  /* 右上角操作：收藏 / 移除，默认隐藏，hover 或键盘聚焦时出现 */
  .cell-ops {
    position: absolute; top: 4px; right: 4px;
    display: flex; gap: 2px;
    opacity: 0; transition: opacity .14s;
  }
  .cell:hover .cell-ops, .cell-ops:focus-within { opacity: 1; }
  .mini {
    display: flex; align-items: center; justify-content: center;
    width: 19px; height: 19px; padding: 0; border-radius: 6px; cursor: pointer;
    color: var(--sp-faint); background: var(--sp-card); border: 1px solid transparent;
    transition: color .14s, background .14s, border-color .14s;
  }
  .mini:hover { color: var(--sp-accent); background: var(--sp-accent-soft); border-color: rgba(var(--sp-accent-rgb), .35); }
  .mini.x:hover { color: var(--sp-danger-text); background: rgba(245, 108, 108, .12); border-color: rgba(245, 108, 108, .35); }
  /* 已收藏：实心琥珀星，常亮提示「这个已经在常用里」 */
  .mini.star { color: #e6a23c; }

  .grid-tip { margin-top: 12px; font-size: 12px; color: var(--sp-faint); }

  /* 空态 */
  .empty {
    display: flex; flex-direction: column; align-items: center; gap: 8px;
    padding: 34px 22px; margin-bottom: 16px;
    text-align: center;
    background: var(--sp-card); border: 1px dashed var(--sp-border); border-radius: var(--sp-radius);
  }
  .empty-ico {
    display: flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; border-radius: 12px;
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border: 1px solid rgba(var(--sp-accent-rgb), .22);
  }
  .empty-t { font-size: 14px; font-weight: 600; color: var(--sp-text); text-shadow: none; }
  .empty-s { max-width: 560px; font-size: 12.5px; line-height: 1.7; color: var(--sp-dim); text-shadow: none; }
  .empty-s b { color: var(--sp-text); font-weight: 600; }

  /* 常用图标库：一行内联文字链接（与卡片 / 分组弹窗同一份 ICON_LIBS、同一样式） */
  .libs { margin-top: 20px; }
  .libs-row {
    display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    font-size: 12.5px;
  }
  .libs-label {
    display: inline-flex; align-items: center; gap: 5px;
    color: var(--sp-dim);
  }
  .lib-link {
    color: var(--sp-accent); text-decoration: none; font-weight: 500;
    transition: opacity .14s;
  }
  .lib-link:hover { text-decoration: underline; opacity: .85; }
  .lib-tip { margin-top: 7px; font-size: 12px; line-height: 1.7; color: var(--sp-faint); }

  @media (max-width: 720px) {
    .q, .add-input { width: 100%; }
    .tabs-count { width: 100%; margin-left: 0; }
  }
</style>
