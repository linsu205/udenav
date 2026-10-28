<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useStore } from '../store';
import { put, post } from '../api';
import { applyTheme } from '../lib/theme';
import { notifyHome } from '../lib/notify';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ArrowUp, ArrowDown, Delete, Plus, InfoFilled, Search } from '@element-plus/icons-vue';

const store = useStore();
const f = reactive({
  logo_text: '', favicon: '', theme: 'light', background_image: '', backgrounds: [] as string[], background_rotate: 0, background_rotate_min: 5, background_blur: 2, background_mask: 0.2,
  margin_top: 14, icon_style: 'info', footer: '', search_box_show: 1, show_clock: 1, content_max_width: 1200,
  content_width_auto: 0, group_margin_top: 30,
  search_engines: [] as any[],
});
const saving = ref(false);

/* ---------------- 改动检测 ----------------
   基线 = 上次「载入配置」或「保存成功」时的整表单快照（JSON 串）。
   当前快照与基线不一致才算有改动 —— 只有这时才显示「取消设置 / 保存配置」。
   用整表单快照而非逐字段比较：以后新增配置项不用回来改这里，也不会漏字段。
   注意基线在 fill() 末尾才取，所以载入时的自动补齐（迁移壁纸库、兜底搜索引擎）
   不会被误判成「用户改了东西」。 */
function snap() { return JSON.stringify(f); }
const baseline = ref('');
const dirty = computed(() => !!baseline.value && snap() !== baseline.value);

function fill() {
  if (!store.config) return;
  Object.assign(f, store.config);
  // 迁移：老数据只有 background_image、没有 backgrounds 时，把当前壁纸塞进库，
  // 避免「壁纸库」显示为空、且上传新图时旧壁纸被落单丢失
  if (!Array.isArray((f as any).backgrounds) || (f as any).backgrounds.length === 0) {
    (f as any).backgrounds = f.background_image ? [f.background_image] : [];
  }
  if (!f.search_engines?.length) f.search_engines = [
    { name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ];
  // 老数据兼容：宽度自适应以前是 0/1 开关，现在存档位百分比，1 折算成 80
  if (Number(f.content_width_auto) === 1) f.content_width_auto = 80;
  // 老数据兼容：轮播间隔以前按「秒」存 background_rotate_sec，现在按分钟存 background_rotate_min
  if (!(Number(f.background_rotate_min) > 0) && (f as any).background_rotate_sec != null) {
    const m = Math.round((Number((f as any).background_rotate_sec) || 0) / 60) || 1;
    f.background_rotate_min = Math.min(60, Math.max(1, m));
  }
  delete (f as any).background_rotate_sec; // 旧键不再回传，避免保存时产生脏字段
  baseline.value = snap();  // 载入完成 → 基线对齐，此时「还没有改动」
}

onMounted(fill);
watch(() => store.config, fill);
// 在后台改主题时即时预览（无需保存刷新）
watch(() => f.theme, t => applyTheme(t));

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    // 多壁纸库：当前图若不在库中（如手动粘贴地址），保存时自动补进库，
    // 保证「库 ⊇ 当前图」，轮播/切换才有历史可用
    if (f.background_image && !f.backgrounds.includes(f.background_image)) {
      f.backgrounds.push(f.background_image);
    }
    await put('/api/admin/config', f);
    baseline.value = snap();   // 保存成功 → 基线推进，两个按钮自动隐藏
    ElMessage.success('配置已保存，前台已同步');
    // 保存成功后让访客前台按新设置刷新（前台重新拉一次公开数据，不整页刷新）
    notifyHome();
  } finally {
    saving.value = false;
  }
}

/* 取消设置：丢弃未保存的改动，表单回滚到上次载入 / 保存成功时的快照。
   回滚后 dirty 归 false，两个按钮随之消失。
   主题是即时预览的，f.theme 被 Object.assign 改回旧值后由下方 watcher 自动还原。 */
function cancelEdit() {
  if (!baseline.value) return;
  try {
    Object.assign(f, JSON.parse(baseline.value));
    ElMessage.info('已取消未保存的修改');
  } catch {
    ElMessage.warning('取消失败，请刷新页面重试');
  }
}

async function uploadFav(opt: any) {
  const fd = new FormData();
  fd.append('file', opt.file);
  try {
    const r = await post<any>('/api/admin/upload', fd);
    f.favicon = r.icon_url;
    ElMessage.success('图标已上传');
  } catch (e: any) {
    /* 后端按「图片管理 → 设置」里的类型 / 单张大小 / 总容量校验，失败原因直接透给用户 */
    ElMessage.error(e?.message || '上传失败');
  }
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
  try {
    const r = await post<any>('/api/admin/upload', fd);
    const url = r.icon_url as string;
    if (!f.backgrounds.includes(url)) f.backgrounds.push(url);
    f.background_image = url; // 新上传自动加入库并设为当前（库在后台维持，不在面板展示）
    ElMessage.success('壁纸已上传并设为当前');
  } catch (e: any) {
    ElMessage.error(e?.message || '上传失败');
  }
}
/* 多壁纸库（不在配置面板铺缩略图，仅后台维持）：上传自动入库并设为当前，
   当前图若不在库中（如手动粘贴地址）会在 save() 时自动补进库 */
const bgPicker = ref(false);
function pickWallpaper(u: string) {
  f.background_image = u;
  bgPicker.value = false;
  ElMessage.success('已设为当前壁纸，点「保存配置」后生效');
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
  const u = f.background_image;
  if (!u) return;
  const i = f.backgrounds.indexOf(u);
  if (i >= 0) f.backgrounds.splice(i, 1);
  f.background_image = f.backgrounds[0] || '';
  ElMessage.info('已移除当前壁纸，点「保存配置」后生效');
}
/* 换地址就得重置：上一张的尺寸不要留在这一张上，失败态也要重新给一次机会 */
watch(bgUrl, () => { bgFailed.value = false; bgDims.value = ''; });

/* ---------------- 预览（右侧） ----------------
   参数改动直接反映在右边预览图上，不用保存回前台确认。口径与访客页一致：
   · 模糊 = filter blur(px)，再放大一点盖住模糊边缘透出的底色（前台是整页铺满看不出来，预览图有小边）
   · 遮罩 = 压在图上的黑/白半透明层（深色主题黑、浅色主题白，跟 .bg-mask 同款）
   · 留白 = 页头起始线，margin_top vh ≈ 视口高度的百分比，预览里就是高度的百分比
   · 内容宽 = 以 1920 宽屏为基准换算成左右百分比留白，页头/搜索栏/卡片都受它约束
   · 时钟/搜索栏 = 直接画 mock（压在壁纸上的文字两个主题都固定白），开关一关连分隔线一起消失
   （卡片外观由每个分组自己的 card_style 决定，预览里骨架卡只示意位置） */
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

/* 预览里的时钟：跟访客页同款走秒，关掉开关时连同分隔线一起消失 */
const now = ref(new Date());
let clockTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { clockTimer = setInterval(() => { now.value = new Date(); }, 1000); });
onUnmounted(() => { if (clockTimer) clearInterval(clockTimer); });
const clockText = computed(() => {
  const d = now.value;
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    t: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
    d: `${d.getMonth() + 1}月${d.getDate()}日 星期${'日一二三四五六'[d.getDay()]}`,
  };
});

/* 宽度自适应档位：0 = 关闭（按固定 content_max_width），50/60/70/80 = 按浏览器可视宽度的百分比。
   老数据存的是布尔式的 1，统一折算成 80，升级后不会出现「看着是开着、实际没生效」。 */
const WIDTH_PCTS = [50, 60, 70, 80];
const autoPct = computed(() => {
  const n = Number(f.content_width_auto) || 0;
  if (n === 1) return 80;
  return WIDTH_PCTS.includes(n) ? n : 0;
});
/* 档位按钮：点即选中；再点一次已选中的档位 = 取消，回到固定宽度（单选，且只能有一个生效） */
function setAutoPct(p: number) {
  f.content_width_auto = autoPct.value === p ? 0 : p;
}

/* 内容最大宽度 → 预览里的左右留白：以 1920 宽屏为基准，1200 时两侧各收 18.75% */
const pvInset = computed(() => {
  // 自适应：按所选档位换算到 1920 画布模型（80% → 1536）；关闭时用固定 content_max_width
  const mw = autoPct.value
    ? 1920 * autoPct.value / 100
    : Math.min(Math.max(Number(f.content_max_width) || 1200, 600), 1920);
  return `${((1 - mw / 1920) * 50).toFixed(2)}%`;
});

/* 分组间距 → 预览骨架卡行的上间距，口径与访客页 --gmt 一致（所有分组同值，两行都绑） */
const pvGMt = computed(() => `${Math.min(Math.max(Number(f.group_margin_top) || 22, 10), 38)}px`);

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

/* 个性化一键恢复默认：先弹窗确认（确认 / 否），确认后才动数据。
   确认动作 = 个性化相关字段重置回初始值 → 落库 → 刷新网页。
   口径与后端 DEFAULT_CONFIG（src/lib/schema.ts）一致，改后端默认值时这里要跟着改 */
async function resetPersonalDefaults() {
  try {
    await ElMessageBox.confirm(
      '确认是否恢复默认？此操作会将主题、壁纸模糊、布局参数恢复为初始状态并刷新页面，但已设置的壁纸照片不会删除。',
      '恢复默认',
      { confirmButtonText: '确认', cancelButtonText: '否', type: 'warning', roundButton: true },
    );
  } catch {
    return; // 点「否」或关闭弹窗 → 直接取消，不改动任何数据
  }
  /* 确认：个性化相关字段恢复到初始状态（保留已上传的壁纸照片，不重置 background_image） */
  f.theme = 'light';
  f.background_blur = 2;
  f.background_mask = 0.2;
  f.margin_top = 14;
  f.content_max_width = 1200;
  f.content_width_auto = 0;
  f.group_margin_top = 30;
  f.background_rotate = 0;
  f.background_rotate_min = 5;
  f.show_clock = 1;
  f.search_box_show = 1;
  try {
    await save(); // 落库 + 同步前台
  } catch {
    return; // 保存失败（save 内部已提示），不刷新
  }
  location.reload(); // 刷新网页，使恢复后的默认值立即生效
}

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
      <!-- 只在真有未保存改动时才出现：没改东西就没有可保存/可取消的东西 -->
      <div v-if="dirty" class="head-actions">
        <el-button type="danger" @click="cancelEdit">取消设置</el-button>
        <el-button type="primary" native-type="button" :loading="saving" @click="save">保存配置</el-button>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">基础</div>
      <!-- 基础区双列：左「站点文字」（标题 / 页脚），右「站点图标」（地址 + 上传 + 标签页预览）。
           原来三个输入框各占一整行，卡片右侧空掉一大截、也没主次；分成两列后信息归组、留白平衡 -->
      <el-form label-position="top" @submit.prevent>
        <div class="base-grid">
          <div class="base-col">
            <el-form-item label="首页标题">
              <el-input v-model="f.logo_text" placeholder="UDeNav" />
            </el-form-item>
            <el-form-item label="页脚文字">
              <el-input v-model="f.footer" placeholder="留空不显示" />
            </el-form-item>
          </div>

          <div class="base-col base-ico">
            <el-form-item label="网站图标 (Favicon)">
              <div class="fav-row">
                <el-input v-model="f.favicon" placeholder="图片 URL，或上传" />
                <el-upload :show-file-list="false" accept="image/*" :http-request="uploadFav" style="flex:none"><el-button>上传</el-button></el-upload>
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
              <!-- 没设图标时也占住位置：右列不会突然塌下去，同时也提示这里能干什么 -->
              <div v-else class="fav-pv empty">
                <span>还没有设置图标</span>
                <span class="fav-empty-sub">上传后这里预览标签页里的样子</span>
              </div>
            </el-form-item>
          </div>
        </div>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-head">
        <div class="sp-card-title">个性化</div>
        <span class="sp-card-gap"></span>
        <el-button type="danger" size="small" title="将个性化设置恢复为默认值（弹窗确认后保存并刷新页面）" @click="resetPersonalDefaults">恢复默认</el-button>
      </div>
      <el-form label-position="top" @submit.prevent>
        <!-- 第一行：主题与壁纸（整宽，内部分两小行） -->
        <div class="zone zone-full">
          <div class="sec-head"><span class="sec-t">主题与壁纸</span></div>
          <div class="bg-ctl">
            <!-- 小行1：主题 + 壁纸地址（含上传） -->
            <div class="ctl-row multi">
              <div class="ctl-cell cell-theme"><el-form-item label="主题">
                <el-select v-model="f.theme" style="width:100%"><el-option value="dark" label="深色" /><el-option value="light" label="浅色" /></el-select>
              </el-form-item></div>
              <div class="ctl-cell cell-grow"><el-form-item label="壁纸地址">
                <div class="bg-url">
                  <el-input v-model="f.background_image" placeholder="粘贴图片 URL，或点右边上传" />
                  <el-upload :show-file-list="false" accept="image/*" :http-request="uploadBg" style="flex:none"><el-button class="bg-url-btn">选择图片</el-button></el-upload>
                  <el-button class="bg-url-btn" @click="bgPicker = true">站点壁纸</el-button>
                </div>
              </el-form-item></div>
            </div>
            <!-- 小行2：壁纸模糊 + 遮罩不透明度 + 壁纸轮播 -->
            <div class="ctl-row multi">
              <div class="ctl-cell"><el-form-item label="壁纸模糊"><el-input-number v-model="f.background_blur" :min="0" :max="30" style="width:100%" /></el-form-item></div>
              <div class="ctl-cell"><el-form-item label="遮罩不透明度"><el-input-number v-model="f.background_mask" :min="0" :max="1" :step="0.05" style="width:100%" /></el-form-item></div>
              <div class="ctl-cell"><el-form-item>
                <template #label>
                  <el-tooltip content="开启后前台自动轮播壁纸库中的多张图片（至少 2 张才生效），间隔按分钟设置，可填 1~60" placement="top" popper-class="sp-tip-wrap">
                    <span class="lbl-tip">壁纸轮播 <el-icon><InfoFilled /></el-icon></span>
                  </el-tooltip>
                </template>
                <div class="rotate-inline">
                  <el-switch v-model="f.background_rotate" :active-value="1" :inactive-value="0" inline-prompt active-text="开" inactive-text="关" />
                  <el-input-number v-if="f.background_rotate === 1" v-model="f.background_rotate_min" :min="1" :max="60" :step="1" style="width:110px" />
                  <span v-if="f.background_rotate === 1" class="rotate-unit">分钟</span>
                </div>
              </el-form-item></div>
            </div>
          </div>
        </div>

        <!-- 第二行：左右布局（左=布局在上、开关在下；右=预览） -->
        <div class="bg-split">
          <div class="bg-left">

            <!-- 布局 -->
            <div class="zone">
              <div class="sec-head"><span class="sec-t">布局</span></div>
              <div class="bg-ctl">
                <div class="ctl-row"><el-form-item label="页头留白 (vh)"><el-input-number v-model="f.margin_top" :min="0" :max="30" style="width:100%" /></el-form-item></div>
                <div class="ctl-row"><el-form-item label="内容最大宽度 (px)"><el-input-number v-model="f.content_max_width" :min="600" :max="1920" :step="10" style="width:100%" :disabled="autoPct !== 0" /></el-form-item></div>
                <div class="ctl-row"><el-form-item label="分组间距 (px)"><el-input-number v-model="f.group_margin_top" :min="10" :max="38" style="width:100%" /></el-form-item></div>
              </div>
            </div>

            <!-- 开关：时钟 / 搜索栏 / 宽度自适应 -->
            <div class="zone">
              <div class="sec-head"><span class="sec-t">开关</span></div>
              <div class="bg-ctl">
                <div class="ctl-row sw-row">
                  <div class="sw-col"><span class="sw-label">时钟 / 日期</span><el-switch v-model="f.show_clock" :active-value="1" :inactive-value="0" /></div>
                  <div class="sw-col"><span class="sw-label">搜索栏</span><el-switch v-model="f.search_box_show" :active-value="1" :inactive-value="0" /></div>
                </div>
                <div class="ctl-row sw-row">
                  <div class="sw-col">
                    <el-tooltip content="按浏览器可视宽度的比例自适应内容区，只能选一档；再点一次已选中的档位即取消，回到上面的固定宽度" placement="top" popper-class="sp-tip-wrap">
                      <span class="sw-label sw-tip"><el-icon><InfoFilled /></el-icon> 宽度自适应</span>
                    </el-tooltip>
                    <div class="pct-group" role="radiogroup" aria-label="宽度自适应比例">
                      <button v-for="p in WIDTH_PCTS" :key="p" type="button" class="pct-btn"
                              :class="{ on: autoPct === p }" :aria-pressed="autoPct === p"
                              @click="setAutoPct(p)">{{ p }}%</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>

          <!-- 预览 -->
          <div class="bg-right">
            <div class="sec-head">
              <span class="sec-t">预览</span>
              <span v-if="bgMeta" class="bg-pv-meta">{{ bgMeta }}</span>
              <span class="bg-pv-gap"></span>
              <el-button v-if="bgUrl" type="danger" size="small" title="清空壁纸地址，前台回到纯色背景" @click="removeBg">移除图片</el-button>
            </div>
            <div class="bg-pv-wrap">
              <div class="bg-pv-stage" :class="{ bad: bgFailed }">
              <template v-if="bgUrl && !bgFailed">
                <img :src="bgUrl" alt="预览" :style="pvImgStyle" @load="onBgLoad" @error="bgFailed = true" />
                <div class="bg-pv-mask" :style="pvMaskStyle"></div>
              </template>
              <div v-if="bgUrl && bgFailed" class="bg-pv-err">图片加载失败，请检查地址是否可访问</div>
              <!-- 叠加层常驻：没选壁纸也能预览页头/搜索栏/卡片的布局效果 -->
              <div class="bg-pv-content" :class="f.theme" :style="{ '--pv-inset': pvInset }">
                <div class="bg-pv-spacer" :style="{ height: pvMt }"></div>
                <div class="bg-pv-line">
                  <span class="bg-pv-w-tag" v-if="autoPct">宽 自适应 {{ autoPct }}%</span>
                  <span class="bg-pv-w-tag" v-else>宽 {{ f.content_max_width }}px</span>
                  <span class="bg-pv-mt-tag">留白 {{ f.margin_top }}vh</span>
                </div>
                <div class="bg-pv-main">
                  <div class="bg-pv-header">
                    <span class="h-logo">{{ f.logo_text || 'UDeNav' }}</span>
                    <template v-if="f.show_clock">
                      <span class="h-sep"></span>
                      <span class="h-clock"><span class="t">{{ clockText.t }}</span><span class="d">{{ clockText.d }}</span></span>
                    </template>
                  </div>
                  <div v-if="f.search_box_show" class="bg-pv-search">
                    <el-icon><Search /></el-icon>
                    <span>搜索</span>
                  </div>
                  <!-- 两行骨架卡 = 两个分组：行间距即「分组间距」参数（访客页所有分组同值），改动实时可见 -->
                  <div class="bg-pv-cards g2" :style="{ marginTop: pvGMt }">
                    <div class="pc" v-for="n in 5" :key="n"></div>
                  </div>
                  <div class="bg-pv-cards g2" :style="{ marginTop: pvGMt }">
                    <div class="pc" v-for="n in 5" :key="'g2-' + n"></div>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        </div>
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

    <!-- 站点壁纸：从「壁纸库」里挑一张设为当前。
         库由上传自动累积（backgrounds），面板里不铺缩略图，只留这个弹窗入口 -->
    <el-dialog v-model="bgPicker" title="站点壁纸" width="680px" class="wp-dlg" append-to-body>
      <div v-if="!f.backgrounds.length" class="wp-empty">
        还没有保存过壁纸。先用左边的「选择图片」上传一张，之后就能在这里切换。
      </div>
      <template v-else>
        <div class="wp-hint">点一张设为当前壁纸<span class="wp-count">共 {{ f.backgrounds.length }} 张</span></div>
        <div class="wp-grid">
          <button
            v-for="(u, i) in f.backgrounds" :key="i" type="button"
            class="wp-item" :class="{ on: u === f.background_image }"
            :title="u === f.background_image ? '当前壁纸' : '设为当前壁纸'"
            @click="pickWallpaper(u)"
          >
            <img :src="u" alt="" loading="lazy" />
            <span v-if="u === f.background_image" class="wp-on">当前</span>
          </button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
  .head-actions { display: flex; gap: 10px; flex: none; }
  @media (max-width: 768px) { .head-actions { width: 100%; } }

  /* ---- 标题栏吸顶 ----
     滚动时「页面配置」+ 右侧按钮组一直贴在顶部，翻到下面也能随手保存。
     两个细节：
     ① .main 的上内边距是 26px，sticky 会贴到滚动容器最顶（y=0），
        不抵消的话一滚动标题就往上跳 26px —— 用负 margin 抵消、padding-top 补回，
        视觉位置与原来完全一致；
     ② 底色用页面底色铺满（含下沿 10px），内容滚到标题底下不会从字缝里透出来。 */
  .sp-page { margin-top: -26px; }
  .sp-page-head {
    position: sticky; top: 0; z-index: 6;
    padding-top: 26px; padding-bottom: 10px; margin-bottom: 8px;
    background: var(--sp-bg);
  }
  /* 窄屏 .main 的上内边距是 18px（见 Dashboard），补偿值跟着走，否则会多顶 8px */
  @media (max-width: 768px) {
    .sp-page { margin-top: -18px; }
    .sp-page-head { padding-top: 18px; }
  }

  /* ---- 卡片标题行：标题居左，「恢复默认」挂在最右 ---- */
  .sp-card-head { display: flex; align-items: center; gap: 8px; }
  .sp-card-gap { flex: 1; }
  .engine-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
  @media (max-width: 768px) {
    .engine-row { flex-wrap: wrap; }
    .engine-row .el-input:first-child { width: 100% !important; }
  }

  /* ---- 基础：双列（左站点文字 / 右站点图标） ---- */
  .base-grid { display: grid; grid-template-columns: minmax(0, 1fr) 348px; gap: 0 22px; align-items: start; }
  .base-col { min-width: 0; }
  /* 两块内容性质不同（站点文字 vs 站点图标），用一条虚线分区，比纯留白更清楚 */
  .base-ico { padding-left: 22px; border-left: 1px dashed var(--sp-border); }
  @media (max-width: 860px) {
    /* 窄屏堆叠：虚线从竖线改横线，避免在单列里留一条莫名其妙的左边框 */
    .base-grid { grid-template-columns: minmax(0, 1fr); }
    .base-ico { padding-left: 0; padding-top: 14px; border-left: 0; border-top: 1px dashed var(--sp-border); }
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
  /* 空态占位：虚线框 + 两行说明，右列高度不塌、也告诉用户这里能干什么 */
  .fav-pv.empty {
    flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    min-height: 84px; border-style: dashed; background: transparent;
    color: var(--sp-dim); font-size: 12.5px; text-align: center; text-shadow: none;
  }
  .fav-empty-sub { font-size: 11.5px; color: var(--sp-faint); }
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
  .bg-url { display: flex; gap: 10px; width: 100%; }
  .bg-url :deep(.el-input) { flex: 1 1 auto; min-width: 0; }
  .bg-url-btn { flex: none; }

  /* ---- 站点壁纸弹窗 ---- 缩略图网格，点一张即设为当前（库里的图按上传顺序排） */
  .wp-hint { display: flex; align-items: center; font-size: 12.5px; color: var(--sp-dim); margin-bottom: 12px; }
  .wp-count { margin-left: auto; color: var(--sp-faint); }
  .wp-grid {
    display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px;
    max-height: 54vh; overflow-y: auto; padding: 2px;
  }
  .wp-item {
    position: relative; padding: 0; cursor: pointer; overflow: hidden;
    aspect-ratio: 16 / 10; border-radius: 10px;
    border: 1.5px solid var(--sp-border); background: var(--sp-card-in);
    transition: border-color .15s, box-shadow .15s, transform .15s;
  }
  .wp-item img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .wp-item:hover { border-color: var(--sp-border-hover); transform: translateY(-1px); }
  .wp-item.on,
  .wp-item.on:hover {
    border-color: var(--sp-accent);
    box-shadow: 0 0 0 2px rgba(var(--sp-accent-rgb), .28);
    transform: none;
  }
  .wp-on {
    position: absolute; left: 6px; top: 6px; padding: 1px 8px;
    border-radius: 20px; font-size: 11px; line-height: 1.7; color: #fff;
    background: rgba(var(--sp-accent-rgb), .92);
  }
  .wp-empty { padding: 40px 12px; text-align: center; font-size: 12.5px; line-height: 1.8; color: var(--sp-dim); }
  .wp-dlg { max-width: 92vw; }
  @media (max-width: 768px) {
    /* 地址行三个元素在窄屏一行放不下：输入框独占一行，两个按钮平分下一行 */
    .bg-url { flex-wrap: wrap; }
    .bg-url :deep(.el-input) { flex: 1 1 100%; }
    .bg-url-btn { flex: 1 1 0; }
    .wp-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  }


  /* 左右分栏：左列固定宽放四个参数，右列吃掉剩余宽度放预览。
     父级不写 align-items，默认 stretch —— 左栏面板会跟预览图一样高，底边能齐 */
  .bg-split { display: flex; gap: 18px; }
  .bg-left { flex: 0 0 260px; min-width: 0; display: flex; flex-direction: column; }
  .bg-right { flex: 1; min-width: 0; display: flex; flex-direction: column; }

  /* 两列共用的小标题行：字号/行高/下边距一致，左右标题才能停在同一基线上 */
  .sec-head { display: flex; align-items: center; gap: 8px; min-height: 22px; margin-bottom: 9px; }
  .sec-t { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  /* 个性化四区：每区独立小标题 + 内嵌控件组，区与区之间留间距 */
  .zone { margin-bottom: 18px; }
  .zone:last-child { margin-bottom: 0; }
  .zone .bg-ctl { flex: 0 0 auto; }

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

  /* 多列行：一行内并排放多个控件（第 1 行「主题与壁纸」两小行用） */
  .ctl-row.multi { gap: 16px; align-items: flex-end; }
  .ctl-cell { flex: 1 1 0; min-width: 0; }
  .ctl-cell.cell-theme { flex: 0 0 180px; }
  .ctl-cell.cell-grow { flex: 1 1 auto; }
  .ctl-cell :deep(.el-form-item) { width: 100%; margin-bottom: 0; }
  /* 标签里带 tooltip 图标时的排版 */
  .lbl-tip { display: inline-flex; align-items: center; gap: 4px; cursor: help; }
  .lbl-tip .el-icon { color: var(--sp-faint); font-size: 13px; }
  /* 壁纸轮播：开关 + 间隔输入并排 */
  .rotate-inline { display: flex; align-items: center; gap: 8px; }
  .rotate-unit { font-size: 12.5px; color: var(--sp-dim); }
  .zone-full { margin-bottom: 18px; }

  @media (max-width: 860px) {
    .bg-split { flex-direction: column; }
    /* 竖排时不再拉伸，否则面板会被撑成一大块 */
    .bg-left { flex: 0 0 auto; width: 100%; }
    .bg-ctl { flex: 0 0 auto; }
    .ctl-row { flex: 0 0 auto; }
    /* 多列行在窄屏下改为纵向堆叠 */
    .ctl-row.multi { flex-direction: column; align-items: stretch; gap: 12px; }
    .ctl-cell.cell-theme { flex: 1 1 auto; }
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
  .bg-pv-wrap { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center;
    border: 1px dashed var(--sp-border); border-radius: 12px;
    background:
      radial-gradient(ellipse 55% 45% at 14% 12%, rgba(var(--sp-accent-rgb), .12), transparent 70%),
      radial-gradient(ellipse 50% 40% at 86% 90%, rgba(var(--sp-accent-rgb), .09), transparent 70%),
      var(--sp-card-in); }
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
  /* 内容起始线：留白变化时这条线跟着走；宽度变化时两侧留白（--pv-inset）也跟着走 */
  .bg-pv-line { position: relative; margin: 0 var(--pv-inset, 7%); border-top: 1px dashed rgba(255, 255, 255, .6); }
  .bg-pv-content.light .bg-pv-line { border-top-color: rgba(50, 50, 50, .4); }
  .bg-pv-mt-tag {
    position: absolute; right: 0; top: 3px;
    font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 20px;
    color: rgba(255, 255, 255, .85); background: rgba(0, 0, 0, .3);
  }
  .bg-pv-content.light .bg-pv-mt-tag { color: rgba(40, 40, 40, .75); background: rgba(255, 255, 255, .55); }
  .bg-pv-w-tag {
    position: absolute; left: 0; top: 3px;
    font-size: 10px; line-height: 1; padding: 2px 6px; border-radius: 20px;
    color: rgba(255, 255, 255, .85); background: rgba(0, 0, 0, .3);
  }
  .bg-pv-content.light .bg-pv-w-tag { color: rgba(40, 40, 40, .75); background: rgba(255, 255, 255, .55); }

  /* 内容区：宽度受「内容最大宽度」约束（预览以 1920 宽屏为基准换算成百分比） */
  .bg-pv-main { flex: 1; min-height: 0; margin: 0 var(--pv-inset, 7%); display: flex; flex-direction: column; }

  /* 页头 mock：logo + 分隔线 + 时钟，压在壁纸上的文字两个主题都固定白（与前台 --on-bg 同口径） */
  .bg-pv-header {
    flex: none; display: flex; align-items: center; justify-content: center; gap: 10px;
    padding-top: 4.5%;
    text-shadow: 0 1px 4px rgba(0, 0, 0, .35);
  }
  .h-logo { font-size: 24px; font-weight: 800; letter-spacing: .5px; color: #fff; line-height: 1.1; }
  .h-sep { width: 1px; height: 26px; background: rgba(255, 255, 255, .5); }
  .h-clock { display: flex; flex-direction: column; align-items: center; line-height: 1.2; color: #fff; }
  .h-clock .t { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .h-clock .d { font-size: 8.5px; opacity: .92; }

  /* 搜索栏 mock：居中半透明胶囊，只示意位置与有无 */
  .bg-pv-search {
    flex: none; margin: 4px auto 0; width: 46%;
    display: flex; align-items: center; gap: 6px;
    padding: 4px 12px; border-radius: 20px;
    font-size: 10.5px; color: rgba(255, 255, 255, .8);
    background: rgba(255, 255, 255, .22);
    border: 1px solid rgba(255, 255, 255, .3);
    backdrop-filter: blur(2px);
  }
  .bg-pv-content.light .bg-pv-search { color: rgba(50, 50, 50, .7); background: rgba(255, 255, 255, .55); border-color: rgba(255, 255, 255, .7); }

  /* 骨架卡：白色玻璃感与前台卡片一致；横向内边距由 .bg-pv-main 统一收 */
  /* 骨架卡固定 70px（与前台 .mic 同尺寸），宽度变大时只增列数、图标尺寸不变 */
  .bg-pv-cards { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0 0; }
  .bg-pv-cards .pc { width: 30px; aspect-ratio: 1; }
  .bg-pv-cards .pc {
    border-radius: 9px;
    background: rgba(255, 255, 255, .38);
    border: 1px solid rgba(255, 255, 255, .35);
  }
  .bg-pv-content.light .bg-pv-cards .pc { background: rgba(255, 255, 255, .55); border-color: rgba(255, 255, 255, .65); }

  /* ---- 左栏「布局」区的开关行：两个开关并排，标签在上（与数字输入同款式） ---- */
  .sw-row { gap: 18px; }
  .sw-col { flex: 1; display: flex; flex-direction: column; gap: 7px; }
  .sw-label { font-size: 12.5px; line-height: 1.3; color: var(--sp-dim); white-space: nowrap; }
  /* 宽度自适应的浮动 tip 触发：信息图标 + 文字，hover 出说明 */
  .sw-tip { display: inline-flex; align-items: center; gap: 4px; cursor: help; color: var(--sp-dim); }
  .sw-tip .el-icon { color: var(--sp-faint); font-size: 13px; }
  /* ---- 宽度自适应档位：50/60/70/80 单选按钮组 ----
     本来是个开关，但只有「80% / 固定」两态；换成按钮组后四档一屏看全、
     点哪个哪个亮（单选），再点已选中的档位就取消、回到固定宽度。 */
  .pct-group {
    align-self: flex-start;   /* 在纵向 flex 列里别被拉满整列宽 */
    display: inline-flex; overflow: hidden;
    border: 1px solid var(--sp-border); border-radius: 8px; background: var(--sp-card-in);
  }
  .pct-btn {
    border: 0; background: none; padding: 5px 11px;
    font: inherit; font-size: 12.5px; line-height: 1.4;
    color: var(--sp-dim); cursor: pointer; transition: background .15s, color .15s;
  }
  .pct-btn + .pct-btn { border-left: 1px solid var(--sp-border); }
  .pct-btn:hover { color: var(--sp-accent); background: var(--sp-chip-bg); }
  .pct-btn.on { color: #fff; background: var(--sp-accent); }

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

<!-- tip 的 popper 会 teleport 到 body，scoped 样式覆盖不到，这里单独用非 scoped 块。
     长文案限制宽度并允许折行，否则 Element Plus 默认一行铺开能到 400px 以上。 -->
<style>
  .el-popper.sp-tip-wrap {
    max-width: 248px;
    white-space: normal;
    word-break: break-word;
    line-height: 1.65;
    font-size: 12.5px;
  }
</style>
