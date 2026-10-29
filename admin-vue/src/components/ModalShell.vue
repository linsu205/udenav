<script setup lang="ts">
/* 后台所有弹窗的统一外壳。
   为什么不直接用 el-dialog：
     1) el-dialog 的遮罩渲染在「调用处」的 DOM 里，后台面板有 backdrop-filter，
        遮罩会被裁成面板那块矩形 —— 打开瞬间只有面板变暗、四周不动，看着就是「闪一下」；
     2) el-dialog 默认锁 body 滚动（overflow:hidden + padding-right 补偿），
        右侧滚动条会被抽走，整页跟着横向抖一下。
   这里换成 teleport 到 body 的 fixed 层，遮罩自己画：
     · 遮罩与卡片同一帧上屏（CSS 里没有任何 transition/animation）
     · 完全不碰 body 滚动，滚动条始终在
     · z-index 走 Element Plus 的管理器，后续下拉框 / ElMessage 自动更高 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useZIndex, ElOverlay } from 'element-plus';

const props = withDefaults(defineProps<{
  title: string;
  /* 卡片宽度，窄屏自动收成 100% */
  width?: string;
  /* 卡片高度上限。默认沿用 780px 的口径；表单特别长的弹窗可以放宽，避免出现内部滚动条 */
  maxHeight?: string;
}>(), { width: '560px', maxHeight: 'min(calc(90vh - 40px), 780px)' });

const emit = defineEmits<{ (e: 'close'): void }>();

const { nextZIndex } = useZIndex();
const zIndex = ref(nextZIndex());

/* 遮罩上滚轮不滚动背后的页面（卡片内部滚动由 .ce-card 的 @wheel.stop 放行） */
function stopPageWheel(e: WheelEvent) { e.preventDefault(); }

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <teleport to="body">
    <el-overlay :z-index="zIndex" class="ce-layer" @wheel="stopPageWheel">
      <div class="ce-card" role="dialog" aria-modal="true" :aria-label="props.title"
           :style="{ '--ce-w': props.width, maxHeight: props.maxHeight }" @wheel.stop>
        <div class="ce-head">
          <!-- #head 插槽：调用方要放页签等自定义头部时用；不传时回落到 title 文本 -->
          <div class="ce-head-main">
            <slot name="head"><span class="ce-title">{{ props.title }}</span></slot>
          </div>
          <button type="button" class="ce-x" aria-label="关闭" @click="emit('close')">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M1.5 1.5l11 11M12.5 1.5l-11 11" fill="none" stroke="currentColor"
                    stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="ce-body">
          <slot />
        </div>
        <div v-if="$slots.footer" class="ce-foot">
          <slot name="footer" />
        </div>
      </div>
    </el-overlay>
  </teleport>
</template>

<style>
  /* 整层：视口铺满、居中；遮罩颜色沿用 Element Plus 的 --el-overlay-color-lighter，
     深浅两个主题自动跟随。不写 transition/animation → 不会「先铺暗色再淡入」 */
  .el-overlay.ce-layer {
    display: flex; align-items: center; justify-content: center;
    padding: 24px;
    overscroll-behavior: contain;
  }

  /* 卡片本体：高度上限跟后台面板一致（min(90vh-40, 780)），
     内容超出时在 .ce-body 内部滚动，不会把外层撑出滚动条 */
  .ce-card {
    width: min(var(--ce-w, 560px), 100%);
    max-height: min(calc(90vh - 40px), 780px);
    display: flex; flex-direction: column;
    background: var(--el-bg-color-overlay, #fff);
    color: var(--el-text-color-primary, #1f2328);
    border: 1px solid var(--el-border-color-lighter, rgba(0, 0, 0, .08));
    border-radius: 10px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, .38);
    overflow: hidden;
  }

  .ce-head {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px 6px;
  }
  .ce-head-main { flex: 1; min-width: 0; }
  .ce-title { font-size: 17px; font-weight: 600; line-height: 1.4; }
  .ce-x {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; padding: 0;
    border: 0; border-radius: 7px; background: transparent;
    color: var(--el-text-color-secondary, #6b7480); cursor: pointer;
    transition: background .15s, color .15s;
  }
  .ce-x:hover { background: var(--el-fill-color, #eceff3); color: var(--el-text-color-primary, #1f2328); }

  .ce-body {
    flex: 1; min-height: 0;
    padding: 10px 20px 2px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  /* 弹窗挂在 body 下，主题里那份滚动条样式只作用于 #adminRoot，这里补一份同口径的 */
  .ce-body::-webkit-scrollbar { width: 8px; height: 8px; }
  .ce-body::-webkit-scrollbar-track { background: transparent; }
  .ce-body::-webkit-scrollbar-thumb { background: var(--sp-scrollbar, #ccd2d9); border-radius: 4px; }
  .ce-body::-webkit-scrollbar-thumb:hover { background: var(--sp-scrollbar-hover, #b4bcc6); }

  .ce-foot {
    flex: 0 0 auto;
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 20px 18px;
  }
</style>
