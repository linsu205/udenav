<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { del, get, put } from '../api';
import { useStore } from '../store';
import { notifyHome } from '../lib/notify';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Picture, Link, Coin, RefreshRight, CopyDocument, Delete, PictureFilled, Setting, Check } from '@element-plus/icons-vue';

/* 图片管理：全库扫一遍——卡片图标 / 站点图片（背景、favicon），
   每张都能预览大图；内嵌 base64 的可以直接清掉省空间（清的是图片字段，不动卡片本身）。
   分组图标不在其中：分组只能选在线图标名（Iconify），走代理取图、不占库，也就没有图可管。 */

interface ImgItem {
  source: 'card' | 'config';
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
const filter = ref<'all' | 'card' | 'config'>('all');
const store = useStore();

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'card', label: '卡片图标' },
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

/* 角标文案。配色不在这里给 —— 深浅主题要两套，交给 CSS 的 .badge.k-inline / .k-link */
const KIND_LABEL: Record<string, string> = { inline: '内嵌', link: '外链' };

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
   只对 source=config 显示按钮：卡片图标是业务图标，当壁纸没有意义。
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
    /* 这张图若不在壁纸库里则追加，再设为当前 —— 这样图片管理里挑图也会进库，旧壁纸不丢 */
    const cur = Array.isArray(store.config?.backgrounds) ? [...store.config.backgrounds] : [];
    if (!cur.includes(it.url)) cur.push(it.url);
    await put('/api/admin/config', { background_image: it.url, backgrounds: cur });
    /* 本地副本同步一份：后台「页面配置」表单直接读 store.config，不刷新也不会回显旧值 */
    if (store.config) { store.config.background_image = it.url; store.config.backgrounds = cur; }
    notifyHome('panel', true);   // 内嵌在访客页时同步前台；独立 /admin 下不刷新，避免跳回配置页
    wpOpen.value = false;
    ElMessage.success('已加入壁纸库并设为当前');
    await load();          // 重新扫一遍，「当前壁纸」的置灰状态才会跟着变
  } catch (e: any) {
    ElMessage.error('设置失败：' + (e?.message || '未知错误'));
  } finally {
    wpSaving.value = false;
  }
}

async function clearImg(it: ImgItem) {
  const isLibBg = it.source === 'config' && it.ref.startsWith('backgrounds.');
  const name = it.source === 'card' ? `卡片「${it.title}」的图标` : `站点${it.title}`;
  const after = it.source === 'card'
    ? '卡片回落为文字图标（卡片本身保留）'
    : isLibBg
      ? '从壁纸库中移除这张（若是当前壁纸会自动切到库内另一张）'
      : '恢复默认的空白设置';
  try {
    await ElMessageBox.confirm(
      `确定清除${name}吗？清除后：${after}。`,
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

/* ---------------- 上传设置 ----------------
   三项策略存在 user_config（image_allow_types / image_max_kb / image_quota_mb），
   后端 /api/admin/upload 读同一份策略做校验 —— 所以这里改完立刻对整个后台生效，
   包括「页面配置」的壁纸 / favicon 上传和卡片编辑里的图标上传。
   保存走 PUT /api/admin/config（按字段 patch，不会碰别的配置项）。 */
const TYPE_OPTS = [
  { mime: 'image/png', label: 'PNG' },
  { mime: 'image/jpeg', label: 'JPG' },
  { mime: 'image/webp', label: 'WebP' },
  { mime: 'image/gif', label: 'GIF' },
  { mime: 'image/svg+xml', label: 'SVG' },
  { mime: 'image/x-icon', label: 'ICO' },
];
const IMG_DEFAULTS = { types: TYPE_OPTS.map((t) => t.mime), maxKb: 256, quotaMb: 20 };

const setOpen = ref(false);
const setSaving = ref(false);
const st = reactive({ types: [...IMG_DEFAULTS.types] as string[], maxKb: IMG_DEFAULTS.maxKb, quotaMb: IMG_DEFAULTS.quotaMb });

function openSettings() {
  const c = (store.config || {}) as any;
  st.types = Array.isArray(c.image_allow_types) && c.image_allow_types.length
    ? [...c.image_allow_types] : [...IMG_DEFAULTS.types];
  st.maxKb = Number(c.image_max_kb) > 0 ? Number(c.image_max_kb) : IMG_DEFAULTS.maxKb;
  st.quotaMb = Number(c.image_quota_mb) >= 0 ? Number(c.image_quota_mb) : IMG_DEFAULTS.quotaMb;
  setOpen.value = true;
}

/* 已用容量对上限的占比：只做提示，真正的拦截在后端（上传时才判断，这里别提前禁用） */
const quotaPct = computed(() => {
  const cap = Number(st.quotaMb) * 1048576;
  if (!cap) return 0;
  return Math.min(100, Math.round((summary.value.inline_bytes / cap) * 100));
});

/* 快捷档位：省得手敲数字，点一下即填 */
const MAX_PRESETS = [128, 256, 512, 1024];
const QUOTA_PRESETS = [10, 20, 50, 100];

function toggleType(mime: string) {
  const i = st.types.indexOf(mime);
  if (i >= 0) {
    if (st.types.length === 1) { ElMessage.warning('至少保留一种图片格式'); return; }
    st.types.splice(i, 1);
  } else {
    st.types.push(mime);
  }
}

const usageOver = computed(() => Number(st.quotaMb) > 0 && summary.value.inline_bytes > Number(st.quotaMb) * 1048576);
const remainBytes = computed(() => Math.max(0, Number(st.quotaMb) * 1048576 - summary.value.inline_bytes));
/* 估算还能存几张「贴着单张上限」的图：存库是 base64，按 1.33 倍折算 */
const fitCount = computed(() => {
  const cap = Number(st.quotaMb) * 1048576;
  const per = Math.max(8, Number(st.maxKb) || 0) * 1024 * 1.33;
  if (!cap || !per) return 0;
  return Math.floor(remainBytes.value / per);
});

async function saveSettings() {
  if (!st.types.length) { ElMessage.warning('至少要允许一种图片类型'); return; }
  if (setSaving.value) return;
  setSaving.value = true;
  try {
    const patch = {
      image_allow_types: [...st.types],
      image_max_kb: Math.round(st.maxKb),
      image_quota_mb: Math.round(st.quotaMb),
    };
    await put('/api/admin/config', patch);
    /* 本地副本同步：其它面板弹窗里选图时读 store.config 做前置判断 */
    if (store.config) Object.assign(store.config, patch);
    setOpen.value = false;
    ElMessage.success('上传设置已保存');
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'));
  } finally {
    setSaving.value = false;
  }
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>图片管理</h2>
        <div class="sub">卡片图标 · 站点图片（背景 / favicon）· 预览与清理</div>
      </div>
      <div class="head-right">
        <el-button :icon="Setting" @click="openSettings">设置</el-button>
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

    <el-empty v-if="!loading && !shown.length" description="没有找到图片——卡片用了文字或在线图标，站点也没设置背景图" />

    <div v-loading="loading" class="grid">
      <div v-for="it in shown" :key="it.source + it.ref" class="img-card">
        <div class="thumb">
          <el-image
            :src="it.url" fit="cover" preview-teleported hide-on-click-modal
            :preview-src-list="[it.url]" :initial-index="0"
            :alt="it.title" loading="lazy" @load="(e: Event) => onImgLoad(e, it)" />
          <span class="badge" :class="'k-' + it.kind">
            <i class="bdot" aria-hidden="true"></i>{{ KIND_LABEL[it.kind] }}
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

    <!-- 上传设置：类型 / 单张大小 / 总容量，保存后后端上传接口立即按新策略校验 -->
    <!-- 宽度用 min() 交给 CSS 兜底窄屏（scoped 的 max-width 选不到 teleport 后的 .el-dialog 根节点） -->
    <el-dialog v-model="setOpen" width="min(600px, 94vw)" class="set-dlg" append-to-body align-center>
      <template #header>
        <div class="set-head">
          <span class="set-head-ico"><el-icon><Setting /></el-icon></span>
          <span class="set-head-txt">
            <span class="set-head-t">上传设置</span>
            <span class="set-head-s">限制上传格式与容量，保存后对图片管理、页面配置里的壁纸上传同时生效</span>
          </span>
        </div>
      </template>

      <div class="set-body">
        <!-- 1. 格式：整块可点的小卡片，选中态靠描边 + 角标，比裸复选框好认 -->
        <section class="set-sec">
          <div class="set-sec-h">
            <span class="set-sec-t">允许的图片格式</span>
            <span class="set-sec-n">已选 {{ st.types.length }} / {{ TYPE_OPTS.length }}</span>
          </div>
          <div class="set-types">
            <button
              v-for="t in TYPE_OPTS" :key="t.mime" type="button"
              class="type-tile" :class="{ on: st.types.includes(t.mime) }"
              :aria-pressed="st.types.includes(t.mime)" @click="toggleType(t.mime)">
              <span class="type-dot"><el-icon><Check /></el-icon></span>
              <span class="type-lb">{{ t.label }}</span>
            </button>
          </div>
          <div class="set-hint">未勾选的格式会被拒绝上传；前端拦一次，后端再校验一次。</div>
        </section>

        <!-- 2. 两个上限并排，省一半竖向空间 -->
        <section class="set-cols">
          <div class="set-box">
            <div class="set-box-h">
              <span class="set-sec-t">单张大小上限</span>
              <span class="set-box-tag">KB</span>
            </div>
            <div class="set-ctl">
              <el-input-number v-model="st.maxKb" :min="8" :max="4096" :step="16" controls-position="right" />
              <span class="set-unit">KB</span>
            </div>
            <div class="set-presets">
              <button
                v-for="v in MAX_PRESETS" :key="v" type="button"
                class="p-chip" :class="{ on: Number(st.maxKb) === v }" @click="st.maxKb = v">{{ v }}</button>
            </div>
            <div class="set-hint">按原文件大小算；以 base64 存库，实际占用约 1.33 倍。</div>
          </div>

          <div class="set-box">
            <div class="set-box-h">
              <span class="set-sec-t">总容量上限</span>
              <span class="set-box-tag">MB</span>
            </div>
            <div class="set-ctl">
              <el-input-number v-model="st.quotaMb" :min="0" :max="500" :step="5" controls-position="right" />
              <span class="set-unit">MB</span>
            </div>
            <div class="set-presets">
              <button
                v-for="v in QUOTA_PRESETS" :key="v" type="button"
                class="p-chip" :class="{ on: Number(st.quotaMb) === v }" @click="st.quotaMb = v">{{ v }}</button>
              <button type="button" class="p-chip" :class="{ on: !st.quotaMb }" @click="st.quotaMb = 0">不限</button>
            </div>
            <div class="set-hint">达到上限后不允许再上传，会提示先删掉不用的图片。</div>
          </div>
        </section>

        <!-- 3. 已用容量看板 -->
        <section class="set-usage-box" :class="{ over: usageOver }">
          <div class="set-usage-top">
            <span class="set-usage-lb">
              <span class="set-sec-t">当前已用容量</span>
              <span class="set-usage-sub">卡片图标 + 站点图片（内嵌 base64 部分）</span>
            </span>
            <span class="set-usage-num">
              <b>{{ inlineBytesText }}</b>
              <span class="set-usage-cap">{{ st.quotaMb ? `/ ${st.quotaMb} MB` : '/ 不限' }}</span>
              <span v-if="st.quotaMb" class="set-usage-pct">{{ quotaPct }}%</span>
            </span>
          </div>
          <div class="set-bar" :class="{ over: usageOver }">
            <i v-if="quotaPct > 0" :style="{ width: quotaPct + '%' }" />
          </div>
          <div class="set-usage-foot">
            <span v-if="!st.quotaMb">当前不限制总容量，容量条仅供参考。</span>
            <span v-else-if="usageOver" class="warn">已超出上限，保存后将无法再上传，请先删除旧图片。</span>
            <span v-else>
              还能存 {{ fmt(remainBytes) }}<template v-if="fitCount">，约 {{ fitCount }} 张 {{ st.maxKb }} KB 的图</template>
            </span>
          </div>
        </section>
      </div>
      <template #footer>
        <el-button :disabled="setSaving" @click="setOpen = false">取消</el-button>
        <el-button type="primary" :loading="setSaving" @click="saveSettings">保存</el-button>
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
  /* 图片来源角标：原先是一圈亮色描边 + 极淡底，小尺寸下描边显脏、字也发虚。
     现在改成无外边框的软底胶囊 + 同色小圆点，深浅主题各一套配色（描边用 inset 阴影，不会因边框变宽而挤字） */
  .badge {
    position: absolute; right: 7px; top: 7px;
    display: inline-flex; align-items: center;
    height: 18px; padding: 0 6px; border-radius: 5px;
    font-size: 10.5px; font-weight: 600; line-height: 1; letter-spacing: .2px;
    /* 先铺一层卡片实底，再叠色：缩略图是照片时半透明底会把图透出来，角标就糊了 */
    background-color: var(--sp-card);
  }
  .bdot {
    width: 4px; height: 4px; margin-right: 4px; border-radius: 50%;
    background: currentColor; opacity: .9; flex: none;
  }
  .badge.k-inline {
    color: #1a6cb5;
    background-image: linear-gradient(rgba(64, 158, 255, .14), rgba(64, 158, 255, .14));
    box-shadow: 0 1px 2px rgba(0, 0, 0, .06), inset 0 0 0 1px rgba(64, 158, 255, .18);
  }
  .badge.k-link {
    color: #8a5a12;
    background-image: linear-gradient(rgba(230, 162, 60, .18), rgba(230, 162, 60, .18));
    box-shadow: 0 1px 2px rgba(0, 0, 0, .06), inset 0 0 0 1px rgba(230, 162, 60, .22);
  }
  /* 深底上把字提到浅色档，否则同色系深字会糊进底里 */
  html.dark .badge.k-inline {
    color: #8cc4ff;
    background-image: linear-gradient(rgba(64, 158, 255, .18), rgba(64, 158, 255, .18));
    box-shadow: 0 1px 2px rgba(0, 0, 0, .18), inset 0 0 0 1px rgba(64, 158, 255, .28);
  }
  html.dark .badge.k-link {
    color: #e8c48a;
    background-image: linear-gradient(rgba(230, 162, 60, .18), rgba(230, 162, 60, .18));
    box-shadow: 0 1px 2px rgba(0, 0, 0, .18), inset 0 0 0 1px rgba(230, 162, 60, .28);
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

  /* ---- 上传设置弹窗 ---- */
  .set-dlg { max-width: 94vw; }
  .set-head { display: flex; align-items: flex-start; gap: 11px; padding-right: 30px; }
  .set-head-ico {
    flex: none; width: 34px; height: 34px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center; font-size: 17px;
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border: 1px solid rgba(var(--sp-accent-rgb), .20);
  }
  .set-head-txt { display: flex; flex-direction: column; min-width: 0; }
  .set-head-t { font-size: 16px; font-weight: 700; line-height: 1.35; color: var(--sp-text); }
  .set-head-s { margin-top: 2px; font-size: 12px; line-height: 1.5; color: var(--sp-faint); }

  .set-body { display: flex; flex-direction: column; gap: 14px; }
  .set-sec { display: flex; flex-direction: column; gap: 9px; }
  .set-sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .set-sec-t { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .set-sec-n { flex: none; font-size: 11.5px; color: var(--sp-faint); }
  .set-hint { font-size: 11.5px; line-height: 1.6; color: var(--sp-faint); }

  /* 格式卡片 */
  .set-types { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
  .type-tile {
    position: relative; display: flex; align-items: center; justify-content: center;
    height: 42px; padding: 0 6px; border-radius: 9px; cursor: pointer;
    font-family: inherit; font-size: 12.5px; font-weight: 600; letter-spacing: .2px;
    color: var(--sp-dim); background: var(--sp-ctrl);
    border: 1px solid var(--sp-border); transition: color .15s, border-color .15s, background .15s;
  }
  .type-tile:hover { color: var(--sp-text); border-color: var(--sp-border-hover); }
  .type-tile.on {
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .45);
  }
  .type-dot {
    position: absolute; right: 4px; top: 4px;
    width: 13px; height: 13px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; font-size: 8px;
    color: #fff; background: var(--sp-accent);
    opacity: 0; transform: scale(.5); transition: opacity .15s, transform .15s;
  }
  .type-dot :deep(.el-icon) { font-size: 9px; }
  .type-tile.on .type-dot { opacity: 1; transform: scale(1); }

  /* 两个上限：并排卡片 */
  .set-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
  .set-box {
    display: flex; flex-direction: column; gap: 8px;
    padding: 11px 12px 12px; border-radius: 11px;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .set-box-h { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .set-box-tag {
    flex: none; padding: 1px 6px; border-radius: 5px;
    font-size: 10.5px; font-weight: 600; letter-spacing: .3px;
    color: var(--sp-faint); background: var(--sp-chip-bg);
  }
  .set-ctl { display: flex; align-items: center; gap: 7px; }
  /* 全局 theme.css 给 .el-input__wrapper 上了 !important 的 ctrl 底色，
     卡片本身就是 card-in 底，同色会糊成一片，所以这里反相提亮成 card 底 + 同款描边 */
  .set-ctl :deep(.el-input-number) { width: 100%; }
  .set-ctl :deep(.el-input__wrapper) {
    background-color: var(--sp-card) !important;
    box-shadow: 0 0 0 1px var(--sp-border) inset !important;
  }
  .set-ctl :deep(.el-input:hover .el-input__wrapper) {
    box-shadow: 0 0 0 1px var(--sp-border-hover) inset !important;
  }
  .set-ctl :deep(.el-input__wrapper.is-focus) {
    box-shadow: 0 0 0 1.5px var(--sp-accent) inset !important;
  }
  .set-ctl :deep(.el-input__inner) { font-weight: 600; color: var(--sp-text); }
  .set-unit { flex: none; font-size: 12px; font-weight: 600; color: var(--sp-dim); }

  .set-presets { display: flex; flex-wrap: wrap; gap: 5px; }
  .p-chip {
    padding: 1px 8px; border-radius: 20px; cursor: pointer; font-family: inherit;
    font-size: 11.5px; line-height: 1.7; color: var(--sp-dim);
    background: var(--sp-card); border: 1px solid var(--sp-border);
    transition: color .15s, border-color .15s, background .15s;
  }
  .p-chip:hover { color: var(--sp-accent); border-color: rgba(var(--sp-accent-rgb), .45); }
  .p-chip.on {
    color: var(--sp-accent); background: var(--sp-accent-soft);
    border-color: rgba(var(--sp-accent-rgb), .45); font-weight: 600;
  }

  /* 已用容量看板 */
  .set-usage-box {
    display: flex; flex-direction: column; gap: 9px;
    padding: 12px 13px; border-radius: 11px;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
    transition: border-color .15s, background .15s;
  }
  .set-usage-box.over { background: rgba(245, 108, 108, .06); border-color: rgba(245, 108, 108, .42); }
  .set-usage-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .set-usage-lb { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .set-usage-sub { font-size: 11.5px; line-height: 1.5; color: var(--sp-faint); }
  .set-usage-num { flex: none; display: inline-flex; align-items: baseline; gap: 4px; font-size: 12px; color: var(--sp-faint); }
  .set-usage-num b { font-size: 15px; font-weight: 700; color: var(--sp-text); }
  .set-usage-box.over .set-usage-num b { color: var(--sp-danger-text); }
  .set-usage-pct {
    padding: 0 5px; border-radius: 5px; font-size: 11px; font-weight: 600;
    color: var(--sp-accent); background: var(--sp-accent-soft);
  }
  .set-usage-box.over .set-usage-pct { color: var(--sp-danger-text); background: rgba(245, 108, 108, .12); }
  /* 自绘容量条：el-progress 的轨道走 el 变量，深色下几乎看不见，这里两端统一 */
  .set-bar {
    position: relative; height: 7px; border-radius: 99px; overflow: hidden;
    background: var(--sp-chip-bg); box-shadow: 0 0 0 1px var(--sp-border) inset;
  }
  .set-bar i {
    display: block; height: 100%; min-width: 6px; border-radius: 99px;
    background: linear-gradient(90deg, var(--sp-accent), var(--el-color-primary-light-3));
    transition: width .25s ease;
  }
  .set-bar.over i { background: linear-gradient(90deg, var(--sp-danger-text), var(--sp-danger)); }
  .set-usage-foot { font-size: 11.5px; line-height: 1.6; color: var(--sp-faint); }
  .set-usage-foot .warn { color: var(--sp-danger-text); font-weight: 600; }

  @media (max-width: 640px) {
    .set-types { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .set-cols { grid-template-columns: minmax(0, 1fr); }
    .set-head-s { display: none; }
  }
</style>
