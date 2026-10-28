<script setup lang="ts">
import { reactive, ref, computed, onMounted, watch } from 'vue';
import { useStore } from '../store';
import { put, post } from '../api';
import { applyTheme } from '../lib/theme';
import { notifyHome } from '../lib/notify';
import { ElMessage } from 'element-plus';
import { ArrowUp, ArrowDown, Delete, Plus, InfoFilled } from '@element-plus/icons-vue';

const store = useStore();
const f = reactive({
  logo_text: '', favicon: '', theme: 'dark', background_image: '', background_blur: 10, background_mask: 0.2,
  margin_top: 6, icon_style: 'info', footer: '', search_box_show: 1, show_clock: 1, content_max_width: 1200,
  search_engines: [] as any[],
});
const saving = ref(false);

function fill() {
  if (!store.config) return;
  Object.assign(f, store.config);
  if (!f.search_engines?.length) f.search_engines = [
    { name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ];
}

onMounted(fill);
watch(() => store.config, fill);
// 在后台改主题时即时预览（无需保存刷新）
watch(() => f.theme, t => applyTheme(t));

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    await put('/api/admin/config', f);
    ElMessage.success('配置已保存，前台已同步');
    // 保存成功后让访客前台按新设置刷新（前台重新拉一次公开数据，不整页刷新）
    notifyHome();
  } finally {
    saving.value = false;
  }
}

async function uploadFav(opt: any) {
  const fd = new FormData();
  fd.append('file', opt.file);
  const r = await post<any>('/api/admin/upload', fd);
  f.favicon = r.icon_url;
  ElMessage.success('图标已上传');
}

/* ---------------- 网站图标预览 ----------------
   仿浏览器标签页：上传/粘贴地址后立刻看到「图标 + 标题」在标签页里的样子，
   不用保存回前台再开新标签页确认。口径与壁纸预览一致：失败给重试机会，
   换地址重置状态，移除只清本地字段（要按「保存配置」才落库）。 */
const favUrl = computed(() => String(f.favicon || '').trim());
const favFailed = ref(false);
const favDims = ref('');

function onFavLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img?.naturalWidth) favDims.value = `${img.naturalWidth}×${img.naturalHeight}`;
}
watch(favUrl, () => { favFailed.value = false; favDims.value = ''; });
function removeFav() {
  f.favicon = '';
  ElMessage.info('已清空图标地址，点右上角「保存配置」后生效');
}

async function uploadBg(opt: any) {
  const fd = new FormData();
  fd.append('file', opt.file);
  const r = await post<any>('/api/admin/upload', fd);
  f.background_image = r.icon_url;
  ElMessage.success('上传成功');
}

function addEngine() { f.search_engines.push({ name: '', url: '' }); }
function rmEngine(i: number) { f.search_engines.splice(i, 1); }
function moveEngine(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= f.search_engines.length) return;
  const arr = f.search_engines;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

/* ---------------- 壁纸预览 ----------------
   上传 / 粘贴地址后立刻在下面看到这张图，不用先保存再回前台确认。
   尺寸从 <img> 的 naturalWidth 读（内嵌图是 base64，后端解析要写一堆文件头分支）；
   体积只有内嵌的能算准（base64 长度 × 3/4），外链拿不到就只显示域名。 */
const bgUrl = computed(() => String(f.background_image || '').trim());
const bgFailed = ref(false);
const bgDims = ref('');

function onBgLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  if (img?.naturalWidth) bgDims.value = `${img.naturalWidth}×${img.naturalHeight}`;
}
/* 只清本地字段，和上传一样要按「保存配置」才落库 —— 不提醒的话很容易以为已经删掉了 */
function removeBg() {
  f.background_image = '';
  ElMessage.info('已清空壁纸地址，点右上角「保存配置」后生效');
}
/* 换地址就得重置：上一张的尺寸不要留在这一张上，失败态也要重新给一次机会 */
watch(bgUrl, () => { bgFailed.value = false; bgDims.value = ''; });

/* ---------------- 效果参数实时预览 ----------------
   模糊/遮罩/留白/卡片样式直接反映在右边预览图上，调参不用保存回前台确认。
   口径与访客页一致：
   · 模糊 = filter blur(px)，再放大一点盖住模糊边缘透出的底色（前台是整页铺满看不出来，预览图有小边）
   · 遮罩 = 压在图上的黑/白半透明层（深色主题黑、浅色主题白，跟 .bg-mask 同款）
   · 留白 = 内容起始线，margin_top vh ≈ 视口高度的百分比，预览里就是高度的百分比
   · 卡片样式 = 起始线下面画几块骨架卡，横排信息卡是长条、网格是方块 */
const pvImgStyle = computed(() => {
  const b = Math.min(Math.max(Number(f.background_blur) || 0, 0), 30);
  return {
    filter: `blur(${b}px)`,
    transform: `scale(${1 + b * 0.006})`,
  };
});
const pvMaskStyle = computed(() => ({
  background: f.theme === 'light'
    ? `rgba(255,255,255,${Math.min(Math.max(Number(f.background_mask) || 0, 0), 1)})`
    : `rgba(0,0,0,${Math.min(Math.max(Number(f.background_mask) || 0, 0), 1)})`,
}));
const pvMt = computed(() => `${Math.min(Math.max(Number(f.margin_top) || 0, 0), 30)}%`);

function fmtBytes(n: number): string {
  if (!n) return '';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

/* 图片元信息（格式/体积/来源域名），壁纸和图标共用；
   尺寸是各自 <img> 量出来的，由调用方追加 */
function baseMeta(v: string): string[] {
  const out: string[] = [];
  const m = /^data:([^;,]+)/.exec(v);
  if (m) {
    /* image/svg+xml 直接 toUpperCase 会显示成「SVG+XML」，给人看的短名单独映射一下 */
    const sub = m[1].replace(/^image\//, '').toLowerCase();
    const NAME: Record<string, string> = {
      jpeg: 'JPG', jpg: 'JPG', png: 'PNG', webp: 'WEBP', gif: 'GIF', avif: 'AVIF',
      'svg+xml': 'SVG', svg: 'SVG', bmp: 'BMP', 'x-icon': 'ICO', 'vnd.microsoft.icon': 'ICO',
    };
    out.push(NAME[sub] || sub.toUpperCase());
    const comma = v.indexOf(',');
    if (comma > 0) out.push(fmtBytes(((v.length - comma - 1) * 3) / 4));
  } else {
    try { out.push(new URL(v).host); } catch { /* 相对路径之类，不显示来源 */ }
  }
  return out;
}

const bgMeta = computed(() => {
  const out = baseMeta(bgUrl.value);
  if (bgDims.value) out.push(bgDims.value);
  return out.filter(Boolean).join(' · ');
});

const favMeta = computed(() => {
  const out = baseMeta(favUrl.value);
  if (favDims.value) out.push(favDims.value);
  return out.filter(Boolean).join(' · ');
});

</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>页面配置</h2>
        <div class="sub">首页标题、壁纸、搜索框等外观设置</div>
      </div>
      <div class="head-actions">
        <el-button @click="notifyHome()">同步到前台</el-button>
        <el-button type="primary" native-type="button" :loading="saving" @click="save">保存配置</el-button>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">基础</div>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="首页标题">
          <el-input v-model="f.logo_text" placeholder="UDeNav" />
        </el-form-item>
        <el-form-item label="网站图标 (Favicon)">
          <div class="fav-row">
            <el-input v-model="f.favicon" placeholder="粘贴图片 URL，或点右边上传" />
            <el-upload :show-file-list="false" accept="image/*" :http-request="uploadFav" style="flex:none"><el-button>上传图标</el-button></el-upload>
          </div>
          <!-- 标签页式预览：图标 + 标题就是访客开新标签页时看到的样子 -->
          <div v-if="favUrl && !favFailed" class="fav-pv">
            <div class="fav-ico">
              <img :src="favUrl" alt="图标预览" @load="onFavLoad" @error="favFailed = true" />
            </div>
            <div class="fav-info">
              <div class="fav-strip">
                <div class="fav-tab">
                  <img :src="favUrl" alt="" @error="favFailed = true" />
                  <span class="fav-tab-t">{{ f.logo_text || 'UDeNav' }}</span>
                  <span class="fav-tab-x">✕</span>
                </div>
              </div>
              <div class="fav-meta-row">
                <span v-if="favMeta" class="fav-meta">{{ favMeta }}</span>
                <span class="fav-gap"></span>
                <button type="button" class="fav-clear" title="清空图标地址" @click="removeFav">移除图标</button>
              </div>
            </div>
          </div>
          <div v-else-if="favUrl && favFailed" class="fav-pv bad">
            <span class="fav-err">图标加载失败，请检查地址是否可访问</span>
            <span class="fav-gap"></span>
            <button type="button" class="fav-clear" @click="removeFav">移除图标</button>
          </div>
        </el-form-item>
        <el-form-item label="页脚文字">
          <el-input v-model="f.footer" placeholder="留空不显示" />
        </el-form-item>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">壁纸</div>
      <el-form label-position="top" @submit.prevent>
        <el-row :gutter="18" class="bg-top">
          <el-col :span="6"><el-form-item label="主题"><el-select v-model="f.theme" style="width:100%"><el-option value="dark" label="深色" /><el-option value="light" label="浅色" /></el-select></el-form-item></el-col>
          <el-col :span="18">
            <el-form-item label="壁纸地址">
              <!-- 地址和上传并成一排：独立一列时按钮孤零零占满整列，看着很空 -->
              <div class="bg-url">
                <el-input v-model="f.background_image" placeholder="留空用纯色背景" />
                <el-upload :show-file-list="false" accept="image/*" :http-request="uploadBg"><el-button class="bg-url-btn">选择图片</el-button></el-upload>
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 左调参右预览：四个参数挤在一条横排时字太小，挪到左边竖着排，
             右边正好空出一整块放预览图（选了图就直接看效果，不用先保存回前台确认）。
             两列各带一行小标题，标题同一基线，下面板/预览等高 -->
        <div class="bg-split">
          <div class="bg-left">
            <div class="sec-head"><span class="sec-t">效果参数</span></div>
            <div class="bg-ctl">
              <div class="ctl-row"><el-form-item label="壁纸模糊"><el-input-number v-model="f.background_blur" :min="0" :max="30" style="width:100%" /></el-form-item></div>
              <div class="ctl-row"><el-form-item label="遮罩不透明度"><el-input-number v-model="f.background_mask" :min="0" :max="1" :step="0.05" style="width:100%" /></el-form-item></div>
              <div class="ctl-row"><el-form-item label="卡片样式"><el-select v-model="f.icon_style" style="width:100%"><el-option value="info" label="横排信息卡" /><el-option value="grid" label="网格" /></el-select></el-form-item></div>
            </div>
          </div>

          <div class="bg-right">
            <div class="sec-head">
              <span class="sec-t">壁纸预览</span>
              <span v-if="bgMeta" class="bg-pv-meta">{{ bgMeta }}</span>
              <span class="bg-pv-gap"></span>
              <button v-if="bgUrl" type="button" class="bg-pv-clear" title="清空壁纸地址，前台回到纯色背景" @click="removeBg">移除图片</button>
            </div>
            <div v-if="bgUrl" class="bg-pv-stage" :class="{ bad: bgFailed }">
              <template v-if="!bgFailed">
                <img :src="bgUrl" alt="壁纸预览" :style="pvImgStyle" @load="onBgLoad" @error="bgFailed = true" />
                <div class="bg-pv-mask" :style="pvMaskStyle"></div>
                <div class="bg-pv-content" :class="f.theme">
                  <div class="bg-pv-spacer" :style="{ height: pvMt }"></div>
                  <div class="bg-pv-line">
                    <span class="bg-pv-mt-tag">内容 {{ f.margin_top }}vh</span>
                  </div>
                  <div class="bg-pv-cards" :class="f.icon_style">
                    <div class="pc" v-for="n in (f.icon_style === 'grid' ? 5 : 3)" :key="n"></div>
                  </div>
                </div>
              </template>
              <div v-else class="bg-pv-err">图片加载失败，请检查地址是否可访问</div>
            </div>
            <div v-else class="bg-empty">填写或上传图片后，在这里预览效果</div>
          </div>
        </div>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">个性化</div>
      <el-form label-position="top" @submit.prevent>
        <el-row :gutter="18">
          <el-col :span="8">
            <el-form-item label="页头留白 (vh)">
              <el-input-number v-model="f.margin_top" :min="0" :max="30" style="width:100%" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="内容最大宽度 (px)">
              <el-input-number v-model="f.content_max_width" :min="600" :max="1920" :step="10" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="布局显示">
          <div class="pl-row">
            <el-checkbox v-model="f.show_clock" :true-value="1" :false-value="0">显示时钟 / 日期</el-checkbox>
            <el-checkbox v-model="f.search_box_show" :true-value="1" :false-value="0">显示搜索栏</el-checkbox>
          </div>
          <div class="pl-hint">关闭「时钟 / 日期」时，标题与时钟之间的分隔竖线会一并隐藏。</div>
        </el-form-item>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">搜索引擎</div>

      <div class="engine-list">
        <div v-for="(e, i) in f.search_engines" :key="i" class="engine-row">
          <span class="engine-idx" :class="{ top: i === 0 }" :title="i === 0 ? '访客页默认选中' : ''">{{ i + 1 }}</span>
          <el-input v-model="e.name" placeholder="名称" class="engine-name" />
          <el-input v-model="e.url" placeholder="https://example.com/search?q=%s" class="engine-url" />
          <div class="engine-ops">
            <button type="button" class="ic-btn" title="上移" :disabled="i === 0" @click="moveEngine(i, -1)">
              <el-icon><ArrowUp /></el-icon>
            </button>
            <button type="button" class="ic-btn" title="下移" :disabled="i === f.search_engines.length - 1" @click="moveEngine(i, 1)">
              <el-icon><ArrowDown /></el-icon>
            </button>
            <button type="button" class="ic-btn del" title="删除" @click="rmEngine(i)">
              <el-icon><Delete /></el-icon>
            </button>
          </div>
        </div>
      </div>

      <div class="engine-foot">
        <span class="engine-hint"><el-icon><InfoFilled /></el-icon>排在第 1 位的是访客页默认选中的搜索引擎</span>
        <el-button class="engine-add" native-type="button" @click="addEngine">
          <el-icon><Plus /></el-icon>添加搜索引擎
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .head-actions { display: flex; gap: 10px; flex: none; }
  @media (max-width: 768px) { .head-actions { width: 100%; } }
  .engine-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
  @media (max-width: 768px) {
    .engine-row { flex-wrap: wrap; }
    .engine-row .el-input:first-child { width: 100% !important; }
  }

  /* ---- 网站图标预览 ---- */
  .fav-row { display: flex; gap: 10px; width: 100%; }
  .fav-pv {
    margin-top: 10px; width: 100%;
    display: flex; align-items: center; gap: 14px;
    padding: 12px 14px;
    border: 1px solid var(--sp-border); border-radius: 12px;
    background: var(--sp-card-in);
  }
  .fav-pv.bad { border-style: dashed; }
  /* 左侧大图块：徽章式底座，透明图标也能看清轮廓 */
  .fav-ico {
    flex: none; width: 58px; height: 58px; border-radius: 14px;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(circle at 30% 25%, var(--sp-hover), transparent 70%),
      var(--sp-chip-bg);
    border: 1px solid var(--sp-border);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, .06);
  }
  .fav-ico img { width: 36px; height: 36px; object-fit: contain; display: block; }
  .fav-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  /* 仿浏览器标签页：圆角朝上的小签子压在一条「标签栏」横线上 */
  .fav-strip {
    display: flex; align-items: flex-end;
    padding: 0 10px;
    border-bottom: 1px solid var(--sp-border);
  }
  .fav-tab {
    display: inline-flex; align-items: center; gap: 7px;
    max-width: 100%;
    padding: 5px 12px 5px 10px;
    border: 1px solid var(--sp-border); border-bottom: none;
    border-radius: 9px 9px 0 0;
    background: var(--sp-hover);
    /* 盖掉标签栏横线，做出「签子嵌在槽里」的效果 */
    margin-bottom: -1px;
  }
  .fav-tab img { width: 14px; height: 14px; object-fit: contain; flex: none; }
  .fav-tab-t {
    font-size: 12px; color: var(--sp-text); line-height: 1.3;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fav-tab-x { font-size: 10px; color: var(--sp-faint); flex: none; line-height: 1; }
  .fav-meta-row { display: flex; align-items: center; gap: 8px; }
  .fav-meta {
    font-size: 11.5px; color: var(--sp-dim); font-variant-numeric: tabular-nums;
    background: var(--sp-chip-bg); padding: 2px 7px; border-radius: 6px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .fav-gap { flex: 1; }
  .fav-clear {
    border: 0; background: none; padding: 3px 8px; border-radius: 7px;
    font: inherit; font-size: 12.5px; color: var(--sp-faint); cursor: pointer; transition: all .15s;
  }
  .fav-clear:hover { color: var(--sp-danger-text); background: var(--sp-chip-bg); }
  .fav-err { font-size: 12px; color: var(--sp-dim); }

  /* ---- 壁纸 ---- */
  /* 顶部主题/地址/上传与下面的「调参 + 预览」是两组东西，用一条虚线隔开 */
  .bg-top { padding-bottom: 12px; border-bottom: 1px dashed var(--sp-border); margin-bottom: 14px; }
  .bg-url { display: flex; gap: 10px; width: 100%; }
  .bg-url-btn { flex: none; }

  /* 左右分栏：左列固定宽放四个参数，右列吃掉剩余宽度放预览。
     父级不写 align-items，默认 stretch —— 左栏面板会跟预览图一样高，底边能齐 */
  .bg-split { display: flex; gap: 18px; }
  .bg-left { flex: 0 0 260px; min-width: 0; display: flex; flex-direction: column; }
  .bg-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  /* 两列共用的小标题行：字号/行高/下边距一致，左右标题才能停在同一基线上 */
  .sec-head { display: flex; align-items: center; gap: 8px; min-height: 22px; margin-bottom: 9px; }
  .sec-t { font-size: 13px; font-weight: 600; color: var(--sp-text); }

  .bg-ctl {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column;
    padding: 2px 14px;
    border: 1px solid var(--sp-border); border-radius: 12px;
    background: var(--sp-card-in);
  }
  /* 每项均分左栏高度 + 细分割线，四项把面板填满，不留一段空尾巴 */
  .ctl-row { flex: 1 1 0; display: flex; align-items: center; padding: 9px 0; border-bottom: 1px solid var(--sp-border); }
  .ctl-row:last-child { border-bottom: 0; }
  .ctl-row :deep(.el-form-item) { width: 100%; margin-bottom: 0; }
  .ctl-row :deep(.el-form-item__label) {
    font-size: 12.5px; line-height: 1.3; color: var(--sp-dim);
    margin-bottom: 5px; padding-bottom: 0; height: auto;
  }
  .ctl-row :deep(.el-input-number) { width: 100%; }

  @media (max-width: 860px) {
    .bg-split { flex-direction: column; }
    /* 竖排时不再拉伸，否则面板会被撑成一大块 */
    .bg-left { flex: 0 0 auto; width: 100%; }
    .bg-ctl { flex: 0 0 auto; }
    .ctl-row { flex: 0 0 auto; }
    /* 一行只有一个控件时不要拉满整屏，太长的数字框很怪 */
    .ctl-row :deep(.el-input-number) { max-width: 240px; }
    .bg-right { width: 100%; margin-top: 14px; }
  }

  /* 预览头部：标题加粗一档，格式/体积/尺寸收成小徽标 */
  .bg-pv-meta {
    font-size: 11.5px; color: var(--sp-dim); font-variant-numeric: tabular-nums;
    background: var(--sp-chip-bg); padding: 2px 7px; border-radius: 6px;
  }
  .bg-pv-gap { flex: 1; }
  .bg-pv-clear {
    border: 0; background: none; padding: 3px 8px; border-radius: 7px;
    font: inherit; font-size: 12.5px; color: var(--sp-faint); cursor: pointer; transition: all .15s;
  }
  .bg-pv-clear:hover { color: var(--sp-danger-text); background: var(--sp-chip-bg); }
  .bg-pv-stage {
    position: relative;
    width: 100%; aspect-ratio: 16 / 9;
    display: flex; align-items: center; justify-content: center;
    border-radius: 12px; overflow: hidden;
    border: 1px solid var(--sp-border); background: var(--sp-card-in);
  }
  .bg-pv-stage img {
    width: 100%; height: 100%; object-fit: cover; display: block;
    transition: filter .2s, transform .2s;
  }
  .bg-pv-stage.bad { border-style: dashed; }
  .bg-pv-err { font-size: 12px; color: var(--sp-dim); }

  /* ---- 效果参数叠加层：复刻前台 .bg-mask / --mt 的视觉口径 ---- */
  .bg-pv-mask { position: absolute; inset: 0; pointer-events: none; }
  .bg-pv-content {
    position: absolute; inset: 0;
    display: flex; flex-direction: column;
    pointer-events: none;
  }
  .bg-pv-spacer { flex: none; }
  /* 内容起始线：margin_top 变化时这条线跟着走，留白调多大一目了然 */
  .bg-pv-line { position: relative; margin: 0 7%; border-top: 1px dashed rgba(255, 255, 255, .6); }
  .bg-pv-content.light .bg-pv-line { border-top-color: rgba(50, 50, 50, .4); }
  .bg-pv-mt-tag {
    position: absolute; right: 0; top: 3px;
    font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 20px;
    color: rgba(255, 255, 255, .85); background: rgba(0, 0, 0, .3);
  }
  .bg-pv-content.light .bg-pv-mt-tag { color: rgba(40, 40, 40, .75); background: rgba(255, 255, 255, .55); }
  /* 骨架卡：横排信息卡 = 长条，网格 = 方块；白色玻璃感与前台卡片一致 */
  .bg-pv-cards { display: flex; gap: 8px; padding: 12px 7% 0; }
  .bg-pv-cards.info { flex-direction: column; gap: 6px; }
  .bg-pv-cards.info .pc { height: 16px; }
  .bg-pv-cards.grid .pc { width: 13%; aspect-ratio: 1; }
  .bg-pv-cards .pc {
    border-radius: 9px;
    background: rgba(255, 255, 255, .38);
    border: 1px solid rgba(255, 255, 255, .35);
  }
  .bg-pv-content.light .bg-pv-cards .pc { background: rgba(255, 255, 255, .55); border-color: rgba(255, 255, 255, .65); }
  /* 没图时也占住同样的位置，免得选图瞬间整块布局跳一下 */
  .bg-empty {
    width: 100%; aspect-ratio: 16 / 9;
    display: flex; align-items: center; justify-content: center;
    border-radius: 12px; border: 1px dashed var(--sp-border);
    background: var(--sp-card-in); color: var(--sp-faint); font-size: 12.5px;
  }

  /* ---- 个性化 ---- */
  .pl-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .pl-hint { width: 100%; font-size: 12px; color: var(--sp-dim); margin-top: 6px; line-height: 1.5; }

  /* ---- 搜索引擎 ---- */
  .engine-list { display: flex; flex-direction: column; gap: 8px; }
  .engine-row { display: flex; align-items: center; gap: 8px; }
  /* 序号：第 1 位是访客页默认引擎，用主色标出来 */
  .engine-idx {
    flex: 0 0 20px; text-align: center;
    font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums;
    color: var(--sp-faint);
  }
  .engine-idx.top { color: var(--sp-accent); }
  .engine-name { flex: 0 0 150px; width: 150px; }
  .engine-url { flex: 1; min-width: 0; }
  .engine-ops { display: flex; flex: none; gap: 2px; }
  /* 图标按钮：平时无边框，hover 才浮出底色；删除只在 hover 时泛红，避免满屏红块 */
  .ic-btn {
    width: 28px; height: 28px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    border: 0; border-radius: 7px; background: none;
    color: var(--sp-dim); font-size: 14px; cursor: pointer;
    transition: background .15s, color .15s;
  }
  .ic-btn:hover:not(:disabled) { background: var(--sp-hover); color: var(--sp-text); }
  .ic-btn:disabled { opacity: .28; cursor: not-allowed; }
  .ic-btn.del { margin-left: 2px; }
  .ic-btn.del:hover { background: rgba(245, 108, 108, .12); color: var(--sp-danger-text); }

  .engine-foot {
    display: flex; align-items: center; justify-content: space-between;
    gap: 10px; flex-wrap: wrap;
    margin-top: 14px; padding-top: 12px;
    border-top: 1px solid var(--sp-border);
  }
  .engine-hint {
    display: flex; align-items: center; gap: 5px;
    font-size: 12px; color: var(--sp-dim);
  }
  .engine-hint :deep(.el-icon) { font-size: 13px; color: var(--sp-faint); }
  .engine-add { border-style: dashed; }
  .engine-add :deep(.el-icon) { margin-right: 5px; }

  @media (max-width: 860px) {
    .engine-row { flex-wrap: wrap; }
    .engine-name { flex: 1 1 auto; width: auto; }
    .engine-url { flex: 1 1 100%; order: 9; }
    .engine-ops { margin-left: auto; }
  }
</style>
