<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { del, get, put } from '../api';
import { useStore } from '../store';
import { notifyHome } from '../lib/notify';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Picture, Link, Coin, RefreshRight, CopyDocument, Delete, PictureFilled } from '@element-plus/icons-vue';

/* 图片管理：全库扫一遍——卡片图标 / 分组图标 / 站点图片（背景、favicon），
   每张都能预览大图；内嵌 base64 的可以直接清掉省空间（清的是图片字段，不动卡片本身）。 */

interface ImgItem {
  source: 'card' | 'group' | 'config';
  ref: string;
  title: string;
  location: string;
  url: string;
  kind: 'inline' | 'link';
  mime: string;
  bytes: number;
}

const loading = ref(false);
const images = ref<ImgItem[]>([]);
const summary = ref({ total: 0, inline: 0, link: 0, inline_bytes: 0 });
const filter = ref<'all' | 'card' | 'group' | 'config'>('all');
const store = useStore();

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'card', label: '卡片图标' },
  { key: 'group', label: '分组图标' },
  { key: 'config', label: '站点图片' },
] as const;

const shown = computed(() => (filter.value === 'all' ? images.value : images.value.filter((i) => i.source === filter.value)));

const inlineBytesText = computed(() => fmt(summary.value.inline_bytes));

async function load() {
  loading.value = true;
  try {
    const r = await get<any>('/api/admin/images');
    images.value = r.images || [];
    summary.value = r.summary || { total: 0, inline: 0, link: 0, inline_bytes: 0 };
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function fmt(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

const KIND_LABEL: Record<string, string> = { inline: '内嵌', link: '外链' };
const KIND_COLOR: Record<string, string> = { inline: '#409eff', link: '#e6a23c' };

/* 图片原始尺寸：等 <img> 加载完从 naturalWidth/Height 读，key 用 source+ref（和列表渲染一致）。
   为什么不放后端算：内嵌图是 base64，解析 PNG/ICO/WEBP 文件头要写一堆分支；
   浏览器本来就会解码，读一下最省事。 */
const dims = reactive<Record<string, string>>({});
const keyOf = (it: ImgItem) => it.source + it.ref;
function onImgLoad(e: Event, it: ImgItem) {
  const img = e.target as HTMLImageElement;
  if (img?.naturalWidth) dims[keyOf(it)] = `${img.naturalWidth}×${img.naturalHeight}`;
}

function host(url: string): string {
  if (url.startsWith('data:')) return '存于数据库';
  try { return new URL(url).host; } catch { return url.slice(0, 40); }
}

async function copyUrl(it: ImgItem) {
  const text = it.kind === 'inline' ? '(内嵌 base64，完整数据见导出备份)' : it.url;
  try {
    await navigator.clipboard.writeText(it.url);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  ElMessage.success(it.kind === 'inline' ? '已复制图片数据' : '已复制图片地址');
}

/* ---------------- 设为当前壁纸 ----------------
   站点图片（配置里的 background_image / favicon）可以直接顶替当前壁纸。
   只对 source=config 显示按钮：卡片 / 分组图标是业务图标，当壁纸没有意义。
   写入走现成的 PUT /api/admin/config（后端按字段 patch，不会碰其它配置项）。 */
const wpOpen = ref(false);
const wpTarget = ref<ImgItem | null>(null);
const wpSaving = ref(false);

/** 已经是壁纸的那一张：优先比地址（favicon 被设成壁纸时 url 会重合），拿不到配置再退回按字段名判断 */
const isWallpaper = (it: ImgItem) => {
  if (it.source !== 'config') return false;
  const cur = store.config?.background_image;
  if (typeof cur === 'string' && cur) return cur === it.url;
  return it.ref === 'background_image';
};

/** 弹窗里的补充提醒：尺寸太小会糊、内嵌会多存一份、外链依赖那个域名 */
const wpNotes = computed(() => {
  const it = wpTarget.value;
  if (!it) return [];
  const out: string[] = [];
  const w = Number((dims[keyOf(it)] || '').split('×')[0] || 0);
  if (w && w < 1280) out.push(`${dims[keyOf(it)]} 的尺寸偏小，铺满屏幕时会被拉伸变糊。`);
  if (it.kind === 'inline') out.push(`这是内嵌图片，设为壁纸会在壁纸配置里再存一份（约 ${fmt(it.bytes)}）。`);
  else out.push(`这是外链图片，前台加载依赖 ${host(it.url)}，该地址失效后壁纸会空白。`);
  return out;
});

function askWallpaper(it: ImgItem) {
  if (isWallpaper(it)) return;
  wpTarget.value = it;
  wpOpen.value = true;
}

async function applyWallpaper() {
  const it = wpTarget.value;
  if (!it || wpSaving.value) return;
  wpSaving.value = true;
  try {
    await put('/api/admin/config', { background_image: it.url });
    /* 本地副本同步一份：后台「页面配置」表单直接读 store.config，不刷新也不会回显旧值 */
    if (store.config) store.config.background_image = it.url;
    notifyHome('panel', true);   // 内嵌在访客页时同步前台；独立 /admin 下不刷新，避免跳回配置页
    wpOpen.value = false;
    ElMessage.success('已设为当前壁纸');
    await load();          // 重新扫一遍，「当前壁纸」的置灰状态才会跟着变
  } catch (e: any) {
    ElMessage.error('设置失败：' + (e?.message || '未知错误'));
  } finally {
    wpSaving.value = false;
  }
}

async function clearImg(it: ImgItem) {
  const name = it.source === 'card' ? `卡片「${it.title}」的图标` : it.source === 'group' ? `分组「${it.title}」的图标` : `站点${it.title}`;
  try {
    await ElMessageBox.confirm(
      `确定清除${name}吗？清除后：${it.source === 'card' ? '卡片回落为文字图标（卡片本身保留）' : it.source === 'group' ? '分组回落为在线图标名' : '恢复默认的空白设置'}。`,
      '清除图片',
      { type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消', lockScroll: false },
    );
  } catch {
    return; // 用户点了取消
  }
  try {
    await del(`/api/admin/images/${it.source}/${encodeURIComponent(it.ref)}`);
    ElMessage.success('已清除');
    await load();
  } catch (e: any) {
    ElMessage.error('清除失败：' + (e?.message || '未知错误'));
  }
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>图片管理</h2>
        <div class="sub">卡片图标 · 分组图标 · 站点图片（背景 / favicon）· 预览与清理</div>
      </div>
      <div class="head-right">
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- 汇总 + 筛选 -->
    <div class="bar">
      <div class="sum">
        <span class="sum-item"><el-icon :size="14"><Picture /></el-icon>共 {{ summary.total }} 张</span>
        <span class="sum-item"><el-icon :size="14" color="#409eff"><Coin /></el-icon>内嵌 {{ summary.inline }} 张 · {{ inlineBytesText }}</span>
        <span class="sum-item"><el-icon :size="14" color="#e6a23c"><Link /></el-icon>外链 {{ summary.link }} 张</span>
      </div>
      <div class="filters">
        <button v-for="f in FILTERS" :key="f.key" class="f-btn" :class="{ on: filter === f.key }" @click="filter = f.key">{{ f.label }}</button>
      </div>
    </div>

    <el-empty v-if="!loading && !shown.length" description="没有找到图片——卡片 / 分组用了文字或在线图标，站点也没设置背景图" />

    <div v-loading="loading" class="grid">
      <div v-for="it in shown" :key="it.source + it.ref" class="img-card">
        <div class="thumb">
          <el-image
            :src="it.url" fit="cover" preview-teleported hide-on-click-modal
            :preview-src-list="[it.url]" :initial-index="0"
            :alt="it.title" loading="lazy" @load="(e: Event) => onImgLoad(e, it)" />
          <span class="badge" :style="{ color: KIND_COLOR[it.kind], borderColor: KIND_COLOR[it.kind] + '55', background: KIND_COLOR[it.kind] + '18' }">
            {{ KIND_LABEL[it.kind] }}
          </span>
        </div>
        <div class="meta">
          <div class="t" :title="it.title">{{ it.title }}</div>
          <div class="loc">{{ it.location }}</div>
          <div class="sz">
            <span v-if="dims[keyOf(it)]" class="dim">{{ dims[keyOf(it)] }}</span>
            <span v-if="dims[keyOf(it)]" class="dot">·</span>
            {{ it.kind === 'inline' ? fmt(it.bytes) : host(it.url) }}
          </div>
        </div>
        <div class="ops">
          <el-button
            v-if="it.source === 'config'" class="op wp" text
            :disabled="isWallpaper(it)"
            :title="isWallpaper(it) ? '这张就是当前的壁纸' : '把这张图设为当前壁纸'"
            @click="askWallpaper(it)">
            <el-icon><PictureFilled /></el-icon>
          </el-button>
          <el-button class="op" text title="复制图片地址" @click="copyUrl(it)">
            <el-icon><CopyDocument /></el-icon>
          </el-button>
          <el-button class="op danger" text title="清除这张图片" @click="clearImg(it)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>
    </div>

    <!-- 设为壁纸的确认框：带大图预览，避免「点了确认才发现选错图」 -->
    <el-dialog
      v-model="wpOpen" title="设为当前壁纸" width="440px" align-center append-to-body
      :close-on-click-modal="!wpSaving" :close-on-press-escape="!wpSaving" :show-close="!wpSaving">
      <div v-if="wpTarget" class="wp-body">
        <div class="wp-stage">
          <img :src="wpTarget.url" alt="" />
          <span class="wp-tag">壁纸预览</span>
        </div>
        <div class="wp-row">
          <span class="wp-k">图片</span>
          <span class="wp-v" :title="wpTarget.title">{{ wpTarget.title }}</span>
        </div>
        <div class="wp-row">
          <span class="wp-k">位置</span>
          <span class="wp-v">{{ wpTarget.location }}</span>
        </div>
        <div class="wp-row">
          <span class="wp-k">说明</span>
          <span class="wp-v">替换「页面配置 → 壁纸地址」，模糊、遮罩、主题等其它设置保持不变。</span>
        </div>
        <div v-if="wpNotes.length" class="wp-notes">
          <div v-for="(n, i) in wpNotes" :key="i" class="wp-note">{{ n }}</div>
        </div>
      </div>
      <template #footer>
        <el-button :disabled="wpSaving" @click="wpOpen = false">取消</el-button>
        <el-button type="primary" :loading="wpSaving" @click="applyWallpaper">设为壁纸</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
  .head-right { display: flex; align-items: center; gap: 10px; }

  .bar {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .sum { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .sum-item {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; color: var(--sp-text);
    background: var(--sp-card); border: 1px solid var(--sp-card-border);
    border-radius: 9px; padding: 7px 12px;
  }
  .filters { display: flex; gap: 6px; }
  .f-btn {
    padding: 6px 13px; border-radius: 8px; font-size: 12.5px; font-family: inherit;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
    color: var(--sp-dim); cursor: pointer; transition: all .15s;
  }
  .f-btn:hover { color: var(--sp-text); }
  .f-btn.on { background: var(--sp-card-in); border-color: var(--sp-accent); color: var(--sp-accent); font-weight: 600; }

  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 14px;
    min-height: 120px;
  }
  .img-card {
    background: var(--sp-card); border: 1px solid var(--sp-card-border); border-radius: 12px;
    overflow: hidden; display: flex; flex-direction: column;
    transition: transform .15s, box-shadow .15s;
  }
  .img-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0, 0, 0, .16); }
  .thumb { position: relative; height: 108px; background: var(--sp-card-in); display: flex; align-items: center; justify-content: center; }
  .thumb :deep(.el-image) { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; cursor: zoom-in; }
  /* 缩略图按图片自身尺寸显示（favicon 多是 16~64px，硬拉到 100% 只会糊成一团）；
     只有超过格子时才等比缩到格子里 */
  .thumb :deep(img) {
    width: auto; height: auto;
    max-width: 100%; max-height: 100%;
    object-fit: contain; padding: 10px; box-sizing: border-box;
    display: block;
  }
  .badge {
    position: absolute; right: 6px; top: 6px;
    font-size: 10.5px; line-height: 1; padding: 4px 7px;
    border-radius: 6px; border: 1px solid; backdrop-filter: blur(4px);
  }
  .meta { padding: 9px 11px 4px; flex: 1; min-width: 0; }
  .t {
    font-size: 13px; font-weight: 600; color: var(--sp-text);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .loc { font-size: 11.5px; color: var(--sp-dim); margin-top: 3px; }
  .sz { font-size: 11px; color: var(--sp-faint); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* 原始尺寸略作强调（如 32×32），后面跟体积/域名 */
  .sz .dim { color: var(--sp-dim); font-weight: 600; }
  .sz .dot { margin: 0 4px; opacity: .6; }
  /* 底部操作条：纯图标靠右排列，文字提示交给 title，卡片底部不再抢视觉 */
  .ops {
    display: flex; align-items: center; justify-content: flex-end; gap: 4px;
    padding: 4px 8px; border-top: 1px solid var(--sp-border); margin-top: 7px;
  }
  /* Element 相邻按钮默认 12px 左边距，靠 gap 控间距 */
  .ops :deep(.el-button + .el-button) { margin-left: 0; }
  .ops :deep(.el-button) {
    flex: 0 0 auto; width: 26px; height: 26px; padding: 0;
    border-radius: 6px; color: var(--sp-dim);
  }
  .ops :deep(.el-button:hover:not(.is-disabled)) { background: var(--sp-hover); color: var(--sp-text); }
  .ops :deep(.el-icon) { font-size: 14px; }
  /* 壁纸是这张卡最有价值的一项，常态就给主色；已是当前壁纸时回落为灰 */
  .ops :deep(.el-button.wp) { color: var(--sp-accent); }
  .ops :deep(.el-button.wp:hover:not(.is-disabled)) { background: var(--sp-accent-soft); color: var(--sp-accent); }
  .ops :deep(.el-button.wp.is-disabled) { color: var(--sp-faint); }
  .ops :deep(.el-button.danger:hover:not(.is-disabled)) { background: rgba(245, 108, 108, .12); color: var(--sp-danger-text); }

  /* ---- 设为壁纸的确认框 ---- */
  .wp-body { display: flex; flex-direction: column; gap: 9px; }
  .wp-stage {
    position: relative; height: 150px; border-radius: 10px; overflow: hidden;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .wp-stage img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .wp-tag {
    position: absolute; left: 8px; top: 8px;
    font-size: 10.5px; line-height: 1; padding: 4px 7px; border-radius: 6px;
    color: #fff; background: rgba(0, 0, 0, .45); backdrop-filter: blur(4px);
  }
  .wp-row { display: flex; gap: 10px; font-size: 12.5px; line-height: 1.6; }
  .wp-k { flex: none; width: 32px; color: var(--sp-faint); }
  .wp-v { min-width: 0; color: var(--sp-text); word-break: break-all; }
  .wp-notes {
    padding: 8px 10px; border-radius: 8px; font-size: 12px; line-height: 1.65;
    color: var(--sp-dim); background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .wp-note + .wp-note { margin-top: 4px; }
</style>
