<script setup lang="ts">
/* 头像裁切器：纯 canvas 实现，不引第三方裁剪库。
   交互：拖动图片挪位置，滚轮 / 滑块缩放；画布是圆形裁切（overflow:hidden + border-radius），
   所见即所得。输出固定 256×256 JPEG（约 10~30KB），后台按 data URL 存进 users.avatar。 */
import { ref, watch, onMounted } from 'vue';
import ModalShell from './ModalShell.vue';
import { ElMessage } from 'element-plus';
import { ZoomIn, ZoomOut } from '@element-plus/icons-vue';

const props = defineProps<{ src: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'done', v: string): void }>();

const SIZE = 300;   // 画布内部分辨率（CSS 尺寸可能被窄屏压缩，交互时按比例换算）
const OUT = 256;    // 输出边长

const canvas = ref<HTMLCanvasElement | null>(null);
const zoom = ref(1);
const ox = ref(0);
const oy = ref(0);
const ready = ref(false);
const dragging = ref(false);

let img: HTMLImageElement | null = null;
let iw = 0;
let ih = 0;
let drag: { x: number; y: number; ox: number; oy: number } | null = null;

/* 基础缩放：cover（短边铺满画布），再乘用户缩放系数 */
function k(size: number) { return Math.max(size / iw, size / ih) * zoom.value; }

/* 偏移限制：图片中心最多挪到「边缘贴住画布边缘」，保证圆内始终有图 */
function clamp() {
  const s = k(SIZE);
  const mx = Math.max(0, (iw * s - SIZE) / 2);
  const my = Math.max(0, (ih * s - SIZE) / 2);
  ox.value = Math.min(mx, Math.max(-mx, ox.value));
  oy.value = Math.min(my, Math.max(-my, oy.value));
}

function paint(c: CanvasRenderingContext2D, size: number) {
  const s = k(size);
  const ratio = size / SIZE;   // 偏移按画布比例换算，保证预览与输出一致
  c.fillStyle = '#fff';        // 透明 PNG 裁完不要变黑底
  c.fillRect(0, 0, size, size);
  if (!img) return;
  c.drawImage(img, size / 2 + ox.value * ratio - (iw * s) / 2, size / 2 + oy.value * ratio - (ih * s) / 2, iw * s, ih * s);
}

function draw() {
  const el = canvas.value;
  const c = el?.getContext('2d');
  if (!el || !c) return;
  paint(c, SIZE);
}

watch([zoom, ox, oy], () => { clamp(); draw(); });

onMounted(() => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => {
    img = im;
    iw = im.naturalWidth;
    ih = im.naturalHeight;
    if (!iw || !ih) {
      ElMessage.error('图片读取失败，请换一张');
      emit('close');
      return;
    }
    ready.value = true;
    draw();
  };
  im.onerror = () => {
    ElMessage.error('图片读取失败，请换一张');
    emit('close');
  };
  im.src = props.src;
});

function onDown(e: PointerEvent) {
  if (!ready.value) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  dragging.value = true;
  drag = { x: e.clientX, y: e.clientY, ox: ox.value, oy: oy.value };
}

function onMove(e: PointerEvent) {
  if (!drag) return;
  const el = canvas.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const scale = rect.width ? SIZE / rect.width : 1;  // CSS 缩放过就按比例放回内部坐标
  ox.value = drag.ox + (e.clientX - drag.x) * scale;
  oy.value = drag.oy + (e.clientY - drag.y) * scale;
  clamp();
  draw();
}

function onUp() { dragging.value = false; drag = null; }

function onWheel(e: WheelEvent) {
  const next = zoom.value * (e.deltaY < 0 ? 1.08 : 0.926);
  zoom.value = Math.min(4, Math.max(1, Number(next.toFixed(3))));
}

function reset() {
  zoom.value = 1;
  ox.value = 0;
  oy.value = 0;
}

function confirm() {
  if (!img) return;
  const c = document.createElement('canvas');
  c.width = OUT;
  c.height = OUT;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  paint(ctx, OUT);
  emit('done', c.toDataURL('image/jpeg', 0.9));
}
</script>

<template>
  <ModalShell title="裁切头像" width="360px" @close="emit('close')">
    <div class="ac-wrap">
      <div class="ac-stage" :class="{ dragging }">
        <canvas ref="canvas" :width="SIZE" :height="SIZE"
                @pointerdown="onDown" @pointermove="onMove"
                @pointerup="onUp" @pointercancel="onUp" @wheel.prevent="onWheel" />
        <div class="ac-ring"></div>
      </div>
      <div class="ac-hint">拖动图片调整位置，滚轮或下面滑块缩放</div>
      <div class="ac-zoom">
        <el-icon><ZoomOut /></el-icon>
        <el-slider v-model="zoom" :min="1" :max="4" :step="0.01" :show-tooltip="false" />
        <el-icon><ZoomIn /></el-icon>
      </div>
    </div>

    <template #footer>
      <el-button @click="reset">重置</el-button>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :disabled="!ready" @click="confirm">确定</el-button>
    </template>
  </ModalShell>
</template>

<style scoped>
  .ac-wrap { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 2px 0 6px; }

  /* 圆形裁切：画布本身是方的，靠圆角 + overflow 裁成圆，所见即所得 */
  .ac-stage {
    position: relative;
    width: 260px; max-width: 100%; aspect-ratio: 1;
    border-radius: 50%; overflow: hidden;
    background: var(--sp-card-in, #f3f5f8);
    cursor: grab; touch-action: none;
    user-select: none;
  }
  .ac-stage.dragging { cursor: grabbing; }
  .ac-stage canvas { display: block; width: 100%; height: 100%; }

  .ac-ring {
    position: absolute; inset: 0; border-radius: 50%; pointer-events: none;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, .92), inset 0 0 0 3px rgba(0, 0, 0, .08);
  }

  .ac-hint { font-size: 12px; line-height: 1.6; color: var(--sp-faint, #99a2ac); text-align: center; }

  .ac-zoom { display: flex; align-items: center; gap: 10px; width: 100%; padding: 0 2px; color: var(--sp-dim, #6b7480); }
  .ac-zoom .el-slider { flex: 1; }
  .ac-zoom .el-icon { flex: none; font-size: 15px; }
</style>
