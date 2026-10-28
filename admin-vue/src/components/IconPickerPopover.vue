<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';
import IIcon from './IIcon.vue';
import {
  RECENT_MAX, FAV_MAX, readRecent, readFav, pushRecent, toggleFav, watchIcons,
} from '../lib/icon-lists';

/* 「常用 / 最近使用」图标选择器：挂在在线图标输入框右侧，
   点开是一格格的图标墙，上面两个 tab 切换。组件自己只管展示和挑，
   选完把名字 emit 出去由父组件写回输入框 —— 这样卡片弹窗和分组弹窗
   能用同一份，行为也不会各自跑偏。 */
const emit = defineEmits<{ (e: 'pick', name: string): void }>();

const recent = ref<string[]>(readRecent());
const fav = ref<string[]>(readFav());
const tab = ref<'fav' | 'recent'>('recent');
const open = ref(false);
const q = ref('');
/* 悬停中的名字：图标墙上挤不下名字，就在底部一行实时报出全名，
   不用去猜「这两个星形到底哪个是 bold、哪个是 duotone」 */
const hover = ref('');

const stop = watchIcons(() => {
  recent.value = readRecent();
  fav.value = readFav();
});
onBeforeUnmount(stop);

const list = computed(() => (tab.value === 'fav' ? fav.value : recent.value));
const limit = computed(() => (tab.value === 'fav' ? FAV_MAX : RECENT_MAX));

/* 只做「过滤」不做分页：图标墙一屏最多 6 行，多余的滚动看，比翻页快 */
const shown = computed(() => {
  const k = q.value.trim().toLowerCase();
  const hit = k ? list.value.filter((n) => n.toLowerCase().includes(k)) : list.value;
  return hit.slice(0, 56);
});

const isStar = (n: string) => fav.value.includes(n);

const emptyText = computed(() => {
  if (q.value.trim()) return '没有匹配的图标';
  if (tab.value === 'fav') return '常用还是空的 —— 在「图标管理」里添加，或悬停图标后点右下角 ☆';
  return '还没有记录 —— 保存一次在线图标后就会出现在这里';
});

/* 打开时默认落在「常用」：那是用户自己挑的，八成就是要找的那几个；
   常用是空的才退回「最近」，避免一开就是一个空面板 */
function onShow(v: boolean) {
  if (v) {
    tab.value = fav.value.length ? 'fav' : 'recent';
  } else {
    hover.value = '';
    q.value = '';
  }
}

function choose(n: string) {
  pushRecent(n);      // 选过即进「最近」并置顶
  emit('pick', n);
  open.value = false;
  q.value = '';
  hover.value = '';
}

/* 悬停的那个图标直接收藏 / 取消收藏，不用跑去图标管理页 */
function star() {
  if (hover.value) toggleFav(hover.value);
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    :width="336"
    placement="bottom-end"
    :teleported="true"
    popper-class="ric-pop"
    :show-arrow="true"
    @show="onShow(true)"
    @hide="onShow(false)"
  >
    <template #reference>
      <button
        type="button"
        class="ric-btn"
        :class="{ on: open }"
        :title="`选择图标（常用 ${fav.length} · 最近 ${recent.length}）`"
      >
        <IIcon name="ri:star-line" :size="15" />
      </button>
    </template>

    <!-- 两个 tab：常用（自己加的）/ 最近使用（自动记录） -->
    <div class="ric-tabs">
      <button type="button" :class="{ on: tab === 'fav' }" @click="tab = 'fav'; q = ''">
        <IIcon name="ri:star-line" :size="12" />常用<b>{{ fav.length }}</b>
      </button>
      <button type="button" :class="{ on: tab === 'recent' }" @click="tab = 'recent'; q = ''">
        <IIcon name="ri:history-line" :size="12" />最近<b>{{ recent.length }}</b>
      </button>
    </div>

    <el-input
      v-if="list.length > 16"
      v-model="q"
      size="small"
      class="ric-q"
      :placeholder="tab === 'fav' ? '在常用里搜' : '在最近用过的图标里搜'"
      clearable
    />

    <div v-if="shown.length" class="ric-grid">
      <button
        v-for="n in shown" :key="n" type="button" class="ric-cell" :title="n"
        @mouseenter="hover = n" @focus="hover = n" @click="choose(n)"
      >
        <IIcon :name="n" :size="18" />
      </button>
    </div>
    <div v-else class="ric-empty">
      <IIcon :name="tab === 'fav' ? 'ri:star-line' : 'ri:inbox-line'" :size="18" />
      <span>{{ emptyText }}</span>
    </div>

    <!-- 底部一行：左边报悬停图标的全名（没悬停时显示规则），右边是收藏开关 -->
    <div class="ric-foot">
      <span class="ric-name" :class="{ on: !!hover }" :title="hover || ''">
        {{ hover || (tab === 'fav' ? `常用长期保留，最多 ${FAV_MAX} 个` : `按使用先后排序 · 只保留最近 ${RECENT_MAX} 个`) }}
      </span>
      <button
        v-if="hover" type="button" class="ric-star" :class="{ on: isStar(hover) }"
        :title="isStar(hover) ? '从常用里移除' : '加入常用'" @click="star"
      >
        <IIcon :name="isStar(hover) ? 'ri:star-fill' : 'ri:star-line'" :size="13" />
      </button>
    </div>
  </el-popover>
</template>

<style scoped>
  /* 触发按钮：和左侧输入框同高（34px）、同圆角，看起来是这条输入框的附属操作 */
  .ric-btn {
    flex: none;
    display: inline-flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; padding: 0;
    border-radius: 8px; cursor: pointer;
    color: var(--sp-dim);
    background: var(--sp-ctrl);
    border: 1px solid var(--sp-border);
    transition: color .14s, background .14s, border-color .14s;
  }
  .ric-btn:hover { color: var(--sp-accent); border-color: rgba(var(--sp-accent-rgb), .55); }
  .ric-btn.on {
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .55);
  }

  /* tab：两格等宽，选中项主色底 */
  .ric-tabs {
    display: flex; gap: 3px; padding: 3px; margin-bottom: 9px;
    border-radius: 9px; background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .ric-tabs button {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 4px;
    height: 24px; padding: 0 6px; border: 0; border-radius: 7px; cursor: pointer;
    background: transparent; color: var(--sp-dim);
    font-size: 12px; font-family: inherit; line-height: 1;
    transition: background .14s, color .14s;
  }
  .ric-tabs button:hover { color: var(--sp-text); }
  .ric-tabs button.on {
    background: var(--sp-card); color: var(--sp-accent); font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, .10);
  }
  .ric-tabs b {
    font-weight: 500; font-size: 10.5px; color: var(--sp-faint);
    font-variant-numeric: tabular-nums;
  }
  .ric-tabs button.on b { color: var(--sp-accent); opacity: .75; }

  .ric-q { margin-bottom: 8px; }
  .ric-q :deep(.el-input__wrapper) { border-radius: 7px; }
  .ric-q :deep(.el-input__inner) { font-size: 12px; }

  /* 图标墙：7 列方形格，名字放在底部那一行（悬停时报全名）。
     padding + 负 margin：第一列/第一行的描边不会被浮层内边距压掉半像素 */
  .ric-grid {
    display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px;
    max-height: 240px; overflow-y: auto; padding: 1px 2px 1px 1px; margin: -1px 0 -1px -1px;
  }
  /* 悬停不位移：这一格在滚动容器里，translateY 会被 overflow 裁掉上边缘（首行尤其明显） */
  .ric-cell {
    display: flex; align-items: center; justify-content: center;
    aspect-ratio: 1; padding: 0; cursor: pointer;
    border-radius: 7px; color: var(--sp-text);
    background: var(--sp-card-in); border: 1px solid transparent;
    transition: color .12s, background .12s, border-color .12s;
  }
  .ric-cell:hover {
    color: var(--sp-accent);
    background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .45);
  }
  .ric-cell:focus-visible {
    outline: 2px solid var(--sp-accent); outline-offset: -1px;
  }

  .ric-empty {
    display: flex; align-items: center; gap: 7px;
    padding: 14px 10px; border-radius: 8px;
    font-size: 12px; line-height: 1.5; color: var(--sp-dim);
    background: var(--sp-card-in); border: 1px dashed var(--sp-border);
  }

  /* 底部一行固定高度：不管显示的是说明还是悬停名，浮层高度都不跳动 */
  .ric-foot {
    display: flex; align-items: center; gap: 6px;
    margin-top: 8px; padding-top: 7px;
    border-top: 1px solid var(--sp-border);
    height: 26px;
  }
  .ric-name {
    flex: 1; min-width: 0;
    font-size: 11px; color: var(--sp-faint);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ric-name.on { color: var(--sp-accent); font-size: 11.5px; }
  .ric-star {
    flex: none; display: inline-flex; align-items: center; justify-content: center;
    width: 22px; height: 22px; padding: 0; border-radius: 6px; cursor: pointer;
    color: var(--sp-faint); background: transparent; border: 1px solid transparent;
    transition: color .14s, background .14s, border-color .14s;
  }
  .ric-star:hover { color: var(--sp-accent); background: var(--sp-accent-soft); }
  .ric-star.on { color: #e6a23c; }
</style>
