<script setup lang="ts">
import { ref, watch } from 'vue';

/* Iconify 图标（矢量）：数据来自后台 /api/icon 代理，内联 SVG 而非 <img>。
   为什么内联：Iconify 的 SVG 用 fill="currentColor" 上色，只有内联进 DOM 才能跟随
   按钮/链接的文字颜色（深色主题、hover 变色都能自动适配）；<img> 里会固定成黑色。
   同页多次使用同一图标只请求一次（模块级缓存 + 并发去重）。 */

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

const props = withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 15 });
const svg = ref('');

async function load(name: string) {
  if (!name) { svg.value = ''; return; }
  if (cache.has(name)) { svg.value = cache.get(name)!; return; }
  let p = inflight.get(name);
  if (!p) {
    const once = () => fetch('/api/icon?name=' + encodeURIComponent(name))
      .then((r) => (r.ok ? r.text() : ''))
      .catch(() => '');
    p = once().then(async (t) => {
      /* 代理偶发超时（上游 Iconify 限流）时给一次重试，且不把空结果写进缓存 ——
         否则这个图标在整页生命周期里都是一块空框，只能靠刷新才能救回来 */
      if (!t) {
        await new Promise((r) => setTimeout(r, 400));
        t = await once();
      }
      if (t) cache.set(name, t);
      inflight.delete(name);
      return t;
    });
    inflight.set(name, p);
  }
  const t = await p;
  /* 防竞态：等待期间 name 又变了，这次结果就丢弃 */
  if (props.name === name) svg.value = t;
}

watch(() => props.name, (n) => load(n), { immediate: true });
</script>

<template>
  <span
    class="iicon"
    :style="{
      width: typeof size === 'number' ? size + 'px' : size,
      height: typeof size === 'number' ? size + 'px' : size,
    }"
    v-html="svg"
  />
</template>

<style scoped>
  .iicon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    vertical-align: -0.15em;
    line-height: 1;
  }
  .iicon :deep(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
