<script setup lang="ts">
import { reactive, computed, watch, ref } from 'vue';
import { post, get } from '../api';
import { ElMessage } from 'element-plus';
import ModalShell from './ModalShell.vue';
import IIcon from './IIcon.vue';
import IconPickerPopover from './IconPickerPopover.vue';
import { readableOn } from '../lib/icon-color';
import { ICON_LIBS, pushRecent } from '../lib/icon-lists';
import { type Group, type IconItem } from '../store';

const props = defineProps<{
  modelValue: { gid: number; it: IconItem | null };
  groups: Group[];
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', it: any): void }>();

const isAdd = computed(() => !props.modelValue.it);

const f = reactive({
  title: '', url: '', lan_url: '', description: '', icon_type: 'color',
  icon_url: '', icon_name: '', icon_text: '', background_color: '', open_method: 2, sort: 0, group_id: 0,
  /* 'link' 普通卡片 | 'calendar' | 'memo' | 'todo' | 'conv' 内置组件 */
  kind: 'link',
});

/* 顶部页签：添加卡片 / 添加组件。编辑态不显示页签（语义是「编辑」而不是「添加」），
   只在编辑组件卡片时给一条说明，提示组件内容在导航页点开使用 */
const tab = ref<'card' | 'widget'>('card');
const isWidgetEdit = computed(() => !!props.modelValue.it && (props.modelValue.it.kind || 'link') !== 'link');
/* 卡片页（预览 + 表单）是否显示：新建时跟随页签，编辑时恒显示 */
const showCardPane = computed(() => !isAdd.value || tab.value === 'card');

/* 可添加的内置组件清单。图标用 Remix Icon（项目图标库已在用同一套命名） */
const WIDGET_DEFS = [
  { kind: 'calendar', title: '日历', desc: '月视图 · 农历节气', icon: 'flat-color-icons:calendar' },
  { kind: 'memo', title: '备忘录', desc: '随手记 · 实时保存', icon: 'twemoji:memo' },
  { kind: 'todo', title: '待办', desc: '任务清单 · 勾选完成', icon: 'thesvg-color:microsoft-todo' },
  { kind: 'conv', title: '换算器', desc: '计算器 · 单位换算', icon: 'ri:scales-3-line' },
] as const;

/* 预览图标地址：data 用上传/粘贴的 icon_url；iconify 走后台 /api/icon 代理取 SVG（与前台一致）。
   颜色必须跟着「预览主题 + 底板」走 —— 不带 color 的话 SVG 里的 currentColor 解析成黑色，深底上就是黑底黑图 */
const previewIconUrl = computed(() => {
  if (f.icon_type === 'data' && f.icon_url) return f.icon_url;
  if (f.icon_type === 'iconify' && f.icon_name) {
    const tint = f.background_color
      ? readableOn(f.background_color)
      : (pvLight.value ? '#1f2328' : '#ffffff');
    return `/api/icon?name=${encodeURIComponent(f.icon_name)}&color=${tint.slice(1)}`;
  }
  return '';
});
/* 前台有两种卡片样式，文字与底板规则都不同：
   - 小图标（card_style=icon，样式名「图标」）：70px 底板 + 名称在下方，文字=图标文字留空取标题，都截 4 字宽
   - 横排信息卡（card_style=info，样式名「卡片」）：46px 底板 + 标题 + 描述，未填图标文字显示标题首字
   预览固定并排展示这两种形态（左「图标」右「卡片」），而不是跟着所选分组二选一 ——
   用户对「图标 / 卡片」的定义就是这两张图，同时看到才知道切换分组后长什么样。 */
const isMini = computed(() =>
  (props.groups.find(g => g.id === f.group_id)?.card_style || 'info') === 'icon');
/* 预览配色：默认跟当前实际主题，也可以在这个弹窗里临时切（只看效果，不影响站点设置）。
   切换只改舞台内的局部变量，不碰 html[data-theme]，关掉弹窗后一切照旧 */
const pvLight = ref(false);
/* 换组提示：编辑态下选了别的分组，明确告诉用户「保存后卡片会搬走并排到末尾」，
   否则用户以为只是改了个标签，回头在原分组找不到卡 */
const groupMoved = computed(() =>
  !isAdd.value && !!f.group_id && f.group_id !== props.modelValue.gid);
const groupMovedName = computed(() => props.groups.find(g => g.id === f.group_id)?.title || '');
/* 图标文字规则与前台一致：字宽=中文/全角1、英文数字0.5，最多 4 个字宽，超出截掉（无省略号）。 */
const WIDE_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000\u2026]/;
const clip4 = (s: string) => {
  let out = '', u = 0;
  for (const ch of String(s ?? '')) {
    const w = WIDE_CHAR.test(ch) ? 1 : 0.5;
    if (u + w > 4) break;
    out += ch; u += w;
  }
  return out;
};
/* 留空图标文字时的兜底显示：小图标取标题截 4 字宽；信息卡取标题首字（同前台 iconHtml）。
   标题也没填就留空 —— 底板空着比一个突兀的「?」更接近实际效果 */
const derivedPlate = computed(() => {
  if (isMini.value) return clip4(f.title || '');
  return (String(f.title || '').trim()[0] || '').toUpperCase();
});
/* 预览字号必须与前台同一张分档表（FS_TEXT）：
   1~2 字 18 / 3 字 16 / 4 字 15 / 5 字 13 / 6 字 12 —— 之前弹窗自写 18/15/13，3 字 15px 与前台 16px 不一致，用户对比出来了 */
const FS_TEXT_SAME = { 1: 18, 2: 18, 3: 16, 4: 15, 5: 13, 6: 12 };
const unitsOf = (s: string) => {
  let u = 0; for (const ch of s) u += WIDE_CHAR.test(ch) ? 1 : 0.5;
  return u;
};
const tierFs = (s: string) => {
  const n = Math.max(1, Math.min(6, Math.ceil(unitsOf(s))));
  return FS_TEXT_SAME[n];
};

/* ---- 左格「图标」= 小图标形态（70px 底板 + 下方名称）---- */
const plateMini = computed(() => {
  const t = (f.icon_text || '').trim();
  return clip4(t) || clip4(f.title || '');
});
const fsMini = computed(() => tierFs(plateMini.value) + 'px');

/* ---- 右格「卡片」= 信息卡形态（46px 底板 + 标题 + 描述）---- */
const plateCard = computed(() => {
  const t = (f.icon_text || '').trim();
  if (t) return clip4(t);
  return (String(f.title || '').trim()[0] || '').toUpperCase();
});
const fsCard = computed(() => {
  /* 未填图标文字时前台走 CSS 默认 20px（不走分档表），预览同样 */
  if (!(f.icon_text || '').trim()) return '20px';
  /* 可用宽 40px（左右各留 3px），超了就缩字号不换行 */
  return Math.min(tierFs(plateCard.value), 40 / Math.max(1, unitsOf(plateCard.value))).toFixed(1) + 'px';
});

/* 标题在卡片里会被前台按 6 个字宽截断（clipName），预览用同一套规则，
   否则预览里放得下的长标题，实际卡片上已经被截成「...」了 */
const NAME_UNITS_MAX = 6;
const unitOf = (ch: string) => (WIDE_CHAR.test(ch) ? 1 : 0.5);
const clipName = (s: string) => {
  const str = String(s ?? '');
  let total = 0;
  for (const ch of str) total += unitOf(ch);
  if (total <= NAME_UNITS_MAX) return str;
  let out = '', u = 0;
  for (const ch of str) {
    const w = unitOf(ch);
    if (u + w > NAME_UNITS_MAX) break;
    out += ch; u += w;
  }
  return out + '…';
};
const previewTitle = computed(() => clipName(f.title || '') || '卡片标题');
/* 描述为空时前台整行不渲染（不是画个空行），预览也不放占位字，保持「预览=实际」 */
const previewDesc = computed(() => String(f.description || ''));

watch(() => props.modelValue, v => {
  /* 每次打开都先对回站点当前主题，避免上一张卡片切成浅色预览后「带着走」 */
  pvLight.value = document.documentElement.dataset.theme === 'light';
  if (v.it) {
    Object.assign(f, v.it);
    /* 老数据没有 kind 字段时 Object.assign 不会覆盖，必须显式兜底回 'link'，
       否则上一张组件卡片的 kind 会残留到这张普通卡片上 */
    f.kind = (v.it as { kind?: string }).kind || 'link';
    if (v.it.icon_type === 'r2') { f.icon_type = 'data'; }
    /* 前台/列表都是「有 icon_url 就显示图片」，历史数据可能 icon_type='color' 但 icon_url 有值
       （如旧版获取图标只写了 URL 没改类型）→ 弹窗按实际数据纠正，有图即选中「图片」tab */
    if (f.icon_url && f.icon_type !== 'data' && f.icon_type !== 'iconify') { f.icon_type = 'data'; }
    /* group_id 兜底成打开时的分组：少数字段可能没随卡片带回来（如前台只传了部分字段），
       留空会让下拉框变空白，保存时还会把 group_id 当成非法值提交 */
    f.group_id = Number(f.group_id) || v.gid;
    /* 组件卡片默认落在「组件」页签，但编辑态不显示页签，这里只为语义分支用 */
    tab.value = (f.kind || 'link') === 'link' ? 'card' : 'widget';
  } else {
    Object.assign(f, { title: '', url: '', lan_url: '', description: '', icon_type: 'color', icon_url: '', icon_name: '', background_color: '', open_method: 2, sort: 0, group_id: v.gid, kind: 'link' });
    tab.value = 'card';
  }
}, { immediate: true });

/* Vue 3 模板里访问不到 document，内联 @click="document..." 会静默失败，
   文件选择框弹不出来 —— 必须包成函数。 */
function pickIconFile() {
  document.getElementById('iconFile')?.click();
}

async function uploadIcon(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await post<any>('/api/admin/upload', fd);
    f.icon_url = r.icon_url;
    ElMessage.success('上传成功');
  } catch (err: any) { ElMessage.error('上传失败：' + err.message); }
}

function save() {
  if (!f.title.trim()) return ElMessage.warning('标题不能为空');
  /* 组件卡片没有网址（点开是面板而不是跳转），不能拿「默认地址必填」去卡它 */
  const isWidget = (f.kind || 'link') !== 'link';
  if (!isWidget && !f.url.trim()) return ElMessage.warning('默认地址不能为空');
  // el-color-picker 点「清除」后 v-model 是 null，统一归一化成空串（= 不设背景色）
  const payload: any = { ...f, title: f.title.trim(), url: f.url.trim(), background_color: f.background_color || '', kind: f.kind || 'link' };
  /* 分组兜底：万一没选（历史数据没带 group_id），回落到打开弹窗时所在的分组，
     不要让 0 传上去 —— 后端会把 0 当非法分组直接拒绝保存 */
  payload.group_id = Number(payload.group_id) || props.modelValue.gid;
  /* 按所选图标类型清掉其他类型的残留字段。不清的话：切回「文字」保存后 icon_url
     还留着旧图，后台列表和前台都是「有 icon_url 就显示图片」，且下次打开弹窗
     会被「有图即纠正为图片 tab」的逻辑改回去 —— 表现为「选了文字保存后又变图片」 */
  if (payload.icon_type === 'color') { payload.icon_url = ''; payload.icon_name = ''; }
  else if (payload.icon_type === 'data') { payload.icon_name = ''; }
  else if (payload.icon_type === 'iconify') {
    payload.icon_url = '';
    /* 真正用上了才记进「最近使用」：只是打开弹窗看一眼不该占位，
       所以记录点放在保存这一下，而不是输入框的 input 事件 */
    if (payload.icon_name.trim()) pushRecent(payload.icon_name.trim());
  }
  emit('save', payload);
}

/**
 * 添加内置组件：不走「保存」按钮，点组件卡片这一次点击就等于确认。
 * 组件本体仍是一条 item_icon 记录（kind 标类型、url 留空），所以直接复用 emit('save')，
 * 分组、排序、前台同步这些链路与普通卡片完全一致。
 */
function addWidget(w: (typeof WIDGET_DEFS)[number]) {
  emit('save', {
    title: w.title,
    url: '',
    lan_url: '',
    description: w.desc,
    icon_type: 'iconify',
    icon_name: w.icon,
    icon_text: '',
    icon_url: '',
    background_color: '',
    open_method: 2,
    kind: w.kind,
    group_id: Number(f.group_id) || props.modelValue.gid,
  });
}

const fetchingIcon = ref(false);
async function fetchFavicon() {
  const u = f.url.trim();
  if (!u) return ElMessage.warning('请先填写默认地址');
  fetchingIcon.value = true;
  try {
    const r = await get<any>('/api/admin/favicon?url=' + encodeURIComponent(u));
    f.icon_url = r.icon;
    f.icon_type = 'data';
    ElMessage.success('图标获取成功');
  } catch (err: any) {
    ElMessage.error('获取失败：' + err.message);
  } finally {
    fetchingIcon.value = false;
  }
}

/* ---------- AI 补全 ----------
   只做「填表」，不发保存请求：补完用户还能改，最后仍要点「保存」才落库。
   模型没配好时后端会退化成只填网页自带信息（标题/描述/主题色），不是报错。 */
const aiFilling = ref(false);
async function aiFill() {
  const u = f.url.trim();
  if (!u) return ElMessage.warning('请先填写默认地址');
  aiFilling.value = true;
  try {
    const r: any = await post('/api/admin/ai/fill', { url: u });
    const it = r.item || {};
    if (it.title) f.title = String(it.title).slice(0, 20);
    if (it.description) f.description = String(it.description).slice(0, 100);
    if (it.color && /^#[0-9a-f]{6}$/i.test(it.color)) f.background_color = it.color;
    /* 图标只在模型真的给出可用名字时才切到「在线图标」tab；
       给不出就保持原样（前台会退回首字母色块），别把用户原来的图刷掉 */
    if (it.icon_name) {
      f.icon_type = 'iconify';
      f.icon_name = String(it.icon_name);
      f.icon_url = '';
    }
    if (it.group_title) {
      const g = (props.groups || []).find((x) => x.title === it.group_title);
      if (g) f.group_id = g.id;
    }
    const note = (r.notes || [])[0];
    if (r.source === 'ai') ElMessage.success('已补全，确认无误后点保存');
    else ElMessage.warning(note || '只填入了网页自带信息');
  } catch (err: any) {
    ElMessage.error('AI 补全失败：' + (err?.message || '未知错误'));
  } finally {
    aiFilling.value = false;
  }
}

/* ---------- 从项目已有图标中挑一个（弹窗） ----------
   入口是「图像地址」行里的「从项目图标选」按钮，弹窗里列出全站卡片正在用的图标
   （复用 /api/admin/images，只取 source=card，按 url 去重）。
   选中后只做一件事：把图片地址写回 icon_url 输入框，不额外改类型 —— 用户本来就在「图片」tab。 */
interface PickImg { source: string; ref: string; title: string; url: string; }
const pickDialog = ref(false);
const pickLoading = ref(false);
const pickImages = ref<PickImg[]>([]);

/* 弹窗固定尺寸：网格 5 列 × 5 行 = 每页 25 个，多了走分页，弹窗高度不随图片数量变化 */
const PICK_PAGE_SIZE = 25;
const pickPage = ref(1);
const pickPageCount = computed(() => Math.max(1, Math.ceil(pickImages.value.length / PICK_PAGE_SIZE)));
const pagedImages = computed(() =>
  pickImages.value.slice((pickPage.value - 1) * PICK_PAGE_SIZE, pickPage.value * PICK_PAGE_SIZE));

async function openPickDialog() {
  pickPage.value = 1;
  pickDialog.value = true;
  pickLoading.value = true;
  try {
    /* 每次打开都重新拉一次：可能刚在「图片管理」里清过图，缓存会过期 */
    const r = await get<any>('/api/admin/images');
    const seen = new Set<string>();
    pickImages.value = (r.images || []).filter((i: PickImg) =>
      i.source === 'card' && i.url && !seen.has(i.url) && seen.add(i.url));
  } catch (err: any) {
    ElMessage.error('图片列表加载失败：' + (err?.message || '未知错误'));
  } finally {
    pickLoading.value = false;
  }
}

function chooseImg(it: PickImg) {
  f.icon_url = it.url;
  f.icon_type = 'data';
  pickDialog.value = false;
  ElMessage.success('已选用「' + it.title + '」的图标');
}
</script>

<template>
  <!-- 弹窗层（遮罩、层级、不锁滚动、ESC 关闭）统一交给 ModalShell -->
  <ModalShell :title="isAdd ? '添加卡片' : (isWidgetEdit ? '编辑组件' : '编辑卡片')" width="720px" max-height="calc(94vh - 24px)" @close="emit('close')">
    <!-- 顶部页签：只在「新建」时出现 —— 编辑已有卡片是「编辑」语义，不需要再切类型 -->
    <template v-if="isAdd" #head>
      <div class="ed-tabs">
        <button type="button" class="ed-tab" :class="{ on: tab === 'card' }" @click="tab = 'card'">
          <IIcon name="ri:file-add-line" :size="16" />添加卡片
        </button>
        <button type="button" class="ed-tab" :class="{ on: tab === 'widget' }" @click="tab = 'widget'">
          <IIcon name="ri:layout-masonry-line" :size="16" />添加组件
        </button>
      </div>
    </template>
    <!-- 编辑态的标题：编辑组件用组件图标，编辑卡片用编辑笔，与页签同款式（图标 16px + 5px 间距） -->
    <template v-else #head>
      <span class="ce-title ed-head">
        <IIcon :name="isWidgetEdit ? 'ri:layout-masonry-line' : 'ri:edit-line'" :size="18" />
        {{ isWidgetEdit ? '编辑组件' : '编辑卡片' }}
      </span>
    </template>

    <!-- ========== 卡片页：效果预览 + 卡片表单 ========== -->
    <template v-if="showCardPane">
      <!-- 编辑组件卡片时给一条说明：组件的内容在导航页点开使用，这里只改外观 -->
      <div v-if="isWidgetEdit" class="wg-note">
        这是内置组件卡片，点击导航页上的卡片即可使用。名称、分组、描述可在此修改；
        图标样式、主色和功能开关到「组件管理」里设置。
      </div>
    <!-- 效果预览：按访客页真实尺寸 1:1 渲染（不是缩略图），底纹镜像访客页背景渐变，
         所以「预览 = 导航实际」。左边是放大的图标本体（看图标细节），右边是卡片成品 -->
    <div class="pv-stage" :class="{ light: pvLight }">
      <div class="pv-bar">
        <span class="pv-tag">导航内效果</span>
        <!-- 主题切换只作用于这块舞台，不写 html[data-theme]，不影响站点实际设置 -->
        <div class="pv-seg">
          <button type="button" :class="{ on: !pvLight }" @click="pvLight = false">
            <IIcon name="ri:moon-line" :size="11" />深色
          </button>
          <button type="button" :class="{ on: pvLight }" @click="pvLight = true">
            <IIcon name="ri:sun-line" :size="11" />浅色
          </button>
        </div>
      </div>

      <div class="pv-row">
        <!-- 图标：小图标形态 —— 70px 底板 + 名称在下方（前台 card_style=icon） -->
        <div class="pv-cell">
          <div class="pv-tile">
            <div class="pv-mic" :class="{ plain: !f.background_color }"
                 :style="f.background_color ? { background: f.background_color } : {}">
              <img v-if="previewIconUrl" :src="previewIconUrl" alt="" />
              <span v-else
                    :style="{ fontSize: fsMini, color: f.background_color ? '#fff' : '', textShadow: f.background_color ? '0 1px 3px rgba(0,0,0,.25)' : 'none' }">{{
                      plateMini }}</span>
            </div>
            <div class="pv-mname">{{ previewTitle }}</div>
          </div>
          <span class="pv-cap">图标</span>
        </div>

        <!-- 卡片：信息卡形态 —— 46px 底板 + 标题 + 描述（前台 card_style=info） -->
        <div class="pv-cell">
          <div class="pv-card">
            <div class="pv-ic" :class="{ plain: !f.background_color }"
                 :style="f.background_color ? { background: f.background_color } : {}">
              <img v-if="previewIconUrl" :src="previewIconUrl" alt="" />
              <span v-else :style="{ fontSize: fsCard }">{{ plateCard }}</span>
            </div>
            <div class="pv-body">
              <div class="pv-title">{{ previewTitle }}</div>
              <div v-if="previewDesc" class="pv-dsc">{{ previewDesc }}</div>
            </div>
          </div>
          <span class="pv-cap">卡片</span>
        </div>
      </div>
    </div>

    <el-form label-position="top" @submit.prevent>
      <!-- 图标风格 tab -->
      <el-radio-group v-model="f.icon_type" style="margin-bottom:16px">
        <el-radio-button value="color">文字</el-radio-button>
        <el-radio-button value="data">图片</el-radio-button>
        <el-radio-button value="iconify">在线图标</el-radio-button>
      </el-radio-group>

      <!-- 图标内容 -->
      <div v-if="f.icon_type === 'color'">
        <el-form-item label="图标文字（留空取标题，最多 4 字，超出截断）">
          <el-input v-model="f.icon_text" maxlength="8" :placeholder="'留空显示：' + derivedPlate" clearable />
        </el-form-item>
      </div>
      <div v-else-if="f.icon_type === 'data'">
        <el-form-item label="图像地址">
          <div style="display:flex;gap:8px;width:100%">
            <el-input v-model="f.icon_url" style="flex:1;min-width:0" placeholder="粘贴图片 URL、本地上传或从项目图标选" />
            <input type="file" accept="image/*" style="display:none" id="iconFile" @change="uploadIcon">
            <el-button @click="pickIconFile">
              <IIcon name="ri:upload-2-line" :size="14" class="btn-ico" />本地上传
            </el-button>
            <el-button @click="openPickDialog">
              <IIcon name="ri:gallery-line" :size="14" class="btn-ico" />从项目图标选
            </el-button>
          </div>
        </el-form-item>
      </div>
      <div v-else-if="f.icon_type === 'iconify'">
        <el-form-item label="在线图标（Iconify 名）">
          <!-- 格式说明放进 placeholder：不再单独占一行，说明直接显示在输入框的空白处 -->
          <div class="ico-row">
            <el-input v-model="f.icon_name" placeholder="格式 前缀:图标名，如 ri:home-fill、mdi:github（留空则用标题首字）" />
            <!-- 右侧时钟按钮 = 最近用过的图标，省得又去图标库翻一遍 -->
            <IconPickerPopover @pick="(n: string) => (f.icon_name = n)" />
          </div>
        </el-form-item>
        <!-- 在线图标库快捷入口：点了去站内搜图标名，复制回填到上面的输入框 -->
        <div class="lib-row">
          <span class="lib-label">图标库：</span>
          <a v-for="l in ICON_LIBS" :key="l.url" class="lib-link" :href="l.url" target="_blank" rel="noopener">
            <IIcon :name="l.icon" :size="13" class="btn-ico" />{{ l.label }}
          </a>
        </div>
      </div>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="标题 *">
            <el-input v-model="f.title" maxlength="20" show-word-limit />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="描述信息">
            <el-input v-model="f.description" maxlength="100" show-word-limit />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="默认地址 *">
        <div style="display:flex;gap:8px;width:100%">
          <el-input v-model="f.url" placeholder="https://">
            <!-- AI 补全放在输入框内右侧：粘贴完网址不用移开鼠标就能点 -->
            <template #suffix>
              <button
                type="button" class="ai-fill" :class="{ busy: aiFilling }" :disabled="aiFilling"
                title="按这个网址补全标题、描述、图标、主题色与分组"
                @click.stop="aiFill"
              >
                <IIcon name="ri:magic-line" :size="13" />
                <span>{{ aiFilling ? '补全中' : 'AI 补全' }}</span>
              </button>
            </template>
          </el-input>
          <el-button :loading="fetchingIcon" @click="fetchFavicon">
            <IIcon name="ri:search-line" :size="14" class="btn-ico" />获取图标
          </el-button>
        </div>
      </el-form-item>
      <!-- 内网地址与打开方式并排：各占一半，省一行高度（弹窗不用出滚动条） -->
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="内网地址（可选）">
            <el-input v-model="f.lan_url" placeholder="http://192.168.x.x" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="打开方式">
            <el-select v-model="f.open_method" style="width:100%">
              <el-option :value="1" label="当前页打开" />
              <el-option :value="2" label="新标签打开" />
              <el-option :value="3" label="弹窗打开" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <!-- 所属分组：常显在表单里（原来藏在「更多选项」且编辑态禁用，等于「不能转移」）。
           换组后卡片按 sort 追加到目标分组末尾，排序逻辑在后端 patchIcon 里保证 -->
      <el-form-item label="所属分组">
        <el-select v-model="f.group_id" style="width:100%" filterable :teleported="true">
          <el-option v-for="g in groups" :key="g.id" :value="g.id" :label="g.title" />
        </el-select>
        <div v-if="groupMoved" class="g-move-tip">
          <IIcon name="ri:corner-down-right-line" :size="12" />
          保存后移到「{{ groupMovedName }}」末尾
        </div>
      </el-form-item>

      <el-collapse style="background:var(--sp-preview-bg);border:1px solid var(--sp-preview-border);border-radius:10px">
        <el-collapse-item title="更多选项（图标背景色、排序）" name="more">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="图标背景色">
                <el-color-picker v-model="f.background_color" show-alpha />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="排序">
                <el-input-number v-model="f.sort" :min="0" style="width:100%" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-collapse-item>
      </el-collapse>
    </el-form>
    </template>

    <!-- ========== 组件页：选一个内置组件，点一下就加到导航 ========== -->
    <div v-if="isAdd && tab === 'widget'" class="wg-pane">
      <p class="wg-tip">选择一个组件，它会以卡片形式加到导航里；点击卡片即可使用。</p>
      <div class="wg-group">
        <span class="wg-group-lb">添加到分组</span>
        <el-select v-model="f.group_id" style="width:100%">
          <el-option v-for="g in groups" :key="g.id" :label="g.title" :value="g.id" />
        </el-select>
      </div>
      <div class="wg-grid">
        <button v-for="w in WIDGET_DEFS" :key="w.kind" type="button" class="wg-card" @click="addWidget(w)">
          <span class="wg-ic"><IIcon :name="w.icon" :size="22" /></span>
          <span class="wg-name">{{ w.title }}</span>
          <span class="wg-desc">{{ w.desc }}</span>
          <span class="wg-add">点击添加</span>
        </button>
      </div>
    </div>

    <!-- 项目图标选择弹窗：append-to-body，z-index 由 Element Plus 管理器分配，会盖在编辑弹窗之上。
         align-center 走 flex 垂直居中（此时 top 不生效），比固定 top:8vh 在高低屏上都不会偏 -->
    <el-dialog v-model="pickDialog" title="选择项目图标" width="560px" align-center append-to-body :lock-scroll="false">
      <div v-loading="pickLoading" class="pick-grid">
        <div v-if="!pickLoading && !pickImages.length" class="pick-empty">还没有卡片在用图片图标</div>
        <div v-for="img in pagedImages" :key="img.ref" class="pick-cell" :title="img.title" @click="chooseImg(img)">
          <img :src="img.url" loading="lazy" alt="" />
          <span class="pick-name">{{ img.title }}</span>
        </div>
      </div>
      <!-- 超过一页才显示分页：弹窗尺寸固定，不因图片数量变化而跳动 -->
      <div v-if="pickPageCount > 1" class="pick-pager">
        <el-pagination
          small background layout="prev, pager, next"
          v-model:current-page="pickPage"
          :page-size="PICK_PAGE_SIZE"
          :total="pickImages.length"
        />
      </div>
      <template #footer>
        <el-button @click="pickDialog = false">取消</el-button>
      </template>
    </el-dialog>

    <template #footer>
      <el-button @click="emit('close')">{{ isAdd && tab === 'widget' ? '关闭' : '取消' }}</el-button>
      <!-- 组件页没有「保存」：点组件卡片那一下即已提交 -->
      <el-button v-if="showCardPane" type="primary" @click="save">保存</el-button>
    </template>
  </ModalShell>
</template>

<style scoped>
/* 输入框 + 「最近使用」按钮同一行：输入框吃掉剩余宽度，按钮固定 34px */
.ico-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

/* 图标库入口：标签固定宽度，链接换行时能与第一行对齐 */
.lib-row {
  display: flex;
  align-items: center;
  gap: 4px 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  font-size: 12px;
}

.lib-label {
  color: var(--sp-dim);
}

/* 在线图标库快捷链接：主题色、无下划线，hover 划线提示可点 */
.lib-link {
  display: inline-flex;
  align-items: center;
  color: var(--sp-accent, #409eff);
  text-decoration: none;
  font-weight: 500;
}

.lib-link:hover {
  text-decoration: underline;
}

/* 按钮/链接内 Iconify 图标与文字的间距（图标用 currentColor，颜色自动跟随） */
.btn-ico {
  margin-right: 5px;
}

/* 地址框内的 AI 补全按钮：小胶囊，跟主题色走；窄屏只留图标 */
.ai-fill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  margin-left: 4px;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  color: var(--sp-accent);
  background: rgba(var(--sp-accent-rgb), .1);
  border: 1px solid rgba(var(--sp-accent-rgb), .28);
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
  transition: background .15s, border-color .15s, opacity .15s;
}
.ai-fill:hover:not(:disabled) { background: rgba(var(--sp-accent-rgb), .18); border-color: var(--sp-accent); }
.ai-fill:disabled { cursor: default; opacity: .6; }
.ai-fill.busy { opacity: .75; }

/* 换组提示：比正文小一档、主题色描边，放在下拉框下面一行，不占表单项高度 */
.g-move-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.4;
  color: var(--sp-accent, #409eff);
}

/* 「更多选项」折叠面板：Element Plus 的 header / content 默认没有左右内边距，
   文字直接贴着圆角边框。这里统一补上，展开收起时左边线也对齐 */
:deep(.el-collapse-item__header) {
  padding-left: 14px;
  padding-right: 14px;
}

:deep(.el-collapse-item__content) {
  padding: 4px 14px 16px;
}

/* 「从已有图片选」网格：固定 5 列 × 5 行（每页 25 个），高度写死 → 弹窗尺寸不随图片数量变化 */
.pick-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  grid-auto-rows: 78px;
  align-content: start;
  gap: 10px;
  background: var(--sp-preview-bg);
  border: 1px dashed var(--sp-preview-border);
  border-radius: 10px;
  padding: 12px;
  /* 5 行 × 78 + 4 个 10px 间距 + 上下 12px 内边距 = 454 */
  height: 454px;
  box-sizing: border-box;
}

.pick-pager {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.pick-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  border-radius: 8px;
  padding: 7px 5px;
  border: 1px solid transparent;
  transition: border-color .15s, background .15s;
}

.pick-cell:hover {
  border-color: var(--sp-accent, #409eff);
  background: var(--sp-hover, rgba(255, 255, 255, .04));
}

.pick-cell img {
  width: 40px;
  height: 40px;
  object-fit: contain;
  border-radius: 8px;
}

.pick-name {
  font-size: 11px;
  color: var(--sp-dim);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pick-empty {
  grid-column: 1 / -1;
  text-align: center;
  color: var(--sp-dim);
  font-size: 12.5px;
  padding: 10px 0;
}

/* ============================================================
   导航内效果预览 —— 数值全部照抄 public/index.html 的 .card / .mini：
   1:1 真实尺寸（不是缩略图），舞台底纹模拟访客页背景，
   卡片用半透明玻璃底，所以必须压在「有画面」的底上才看得出真实质感。
   ============================================================ */
.pv-stage {
  /* 深色主题（访客页默认）下的前台卡片配色 */
  --pv-card-bg: rgba(74, 82, 98, .52);
  --pv-card-bd: rgba(255, 255, 255, .08);
  --pv-card-sh: 0 4px 16px rgba(0, 0, 0, .18);
  --pv-title-c: #f5f6f7;
  --pv-dsc-c: #a9afb6;
  --pv-stage-bg: linear-gradient(140deg, #39424e 0%, #222831 55%, #2f3843 100%);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  justify-content: center;
  min-height: 176px;
  padding: 30px 18px 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: var(--pv-stage-bg);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .06);
  overflow: hidden;
}

/* 浅色预览：颜色挂在 .light 上而不是 html[data-theme] —— 这样弹窗里可以随便切，
   只影响这块舞台，站点主题不会被改动。数值与访客页 data-theme=light 那套一致 */
.pv-stage.light {
  --pv-card-bg: rgba(255, 255, 255, .82);
  --pv-card-bd: rgba(31, 35, 40, .10);
  --pv-card-sh: 0 4px 16px rgba(31, 35, 40, .14);
  --pv-title-c: #606266;
  --pv-dsc-c: #909399;
  --pv-stage-bg: linear-gradient(140deg, #d5dde6 0%, #b7c3d0 55%, #c9d3dd 100%);
  box-shadow: inset 0 0 0 1px rgba(31, 35, 40, .06);
}

/* 顶部一行：左侧说明 + 右侧主题切换 */
.pv-bar {
  position: absolute;
  top: 8px;
  left: 12px;
  right: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.pv-tag {
  font-size: 10.5px;
  letter-spacing: .06em;
  color: rgba(255, 255, 255, .5);
  pointer-events: none;
}

.pv-stage.light .pv-tag {
  color: rgba(31, 35, 40, .42);
}

/* 浅色 / 深色预览切换：两格胶囊，当前项提亮 */
.pv-seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: rgba(255, 255, 255, .09);
  border: 1px solid rgba(255, 255, 255, .12);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.pv-seg button {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 20px;
  padding: 0 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: rgba(255, 255, 255, .62);
  font-size: 11px;
  font-family: inherit;
  line-height: 1;
  cursor: pointer;
  transition: background .15s, color .15s;
}

.pv-seg button:hover {
  color: #fff;
}

.pv-seg button.on {
  background: rgba(255, 255, 255, .92);
  color: #1f2328;
}

.pv-stage.light .pv-seg {
  background: rgba(255, 255, 255, .55);
  border-color: rgba(31, 35, 40, .12);
}

.pv-stage.light .pv-seg button {
  color: rgba(31, 35, 40, .55);
}

.pv-stage.light .pv-seg button:hover {
  color: #1f2328;
}

.pv-stage.light .pv-seg button.on {
  background: #fff;
  color: #1f2328;
  box-shadow: 0 1px 3px rgba(31, 35, 40, .18);
}

/* 两块预览并排：底部对齐，下面的小标题才能齐平 */
.pv-row {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 26px;
}

.pv-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.pv-cap {
  font-size: 10.5px;
  letter-spacing: .08em;
  color: rgba(255, 255, 255, .45);
}

.pv-stage.light .pv-cap {
  color: rgba(31, 35, 40, .38);
}

/* 图标格：小图标形态 —— 70px 底板 + 名称在下，与前台 .mini 一致 */
.pv-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

/* ---- 横排信息卡：高 70 / 圆角 16 / 内距 11·14 / 间距 12 ---- */
.pv-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 236px;
  height: 70px;
  padding: 11px 14px;
  border-radius: 16px;
  background: var(--pv-card-bg);
  border: 1px solid var(--pv-card-bd);
  box-shadow: var(--pv-card-sh);
  overflow: hidden;
  box-sizing: border-box;
}

.pv-ic {
  flex: 0 0 46px;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 700;
  line-height: 1;
  overflow: hidden;
}

/* 前台用 translateY(-1.5px) 校准 CJK 字面的墨迹下沉，预览同步 */
.pv-ic span {
  transform: translateY(-1.5px);
  white-space: nowrap;
}

/* 未设背景色：真透明（访客页 .card .ic.plain 同样处理），图标直接浮在卡片上。
   这里不能画玻璃方块——卡片本身就是玻璃，再叠一层只会多出一圈描边 */
.pv-ic.plain {
  background: transparent;
  border: 0;
}

/* 透明底板上白字看不见（浅色预览的卡片接近白色），改深色字 */
.pv-stage.light .pv-ic.plain {
  color: var(--pv-title-c);
}

.pv-ic img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.pv-body {
  min-width: 0;
}

.pv-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--pv-title-c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pv-dsc {
  margin-top: 3px;
  font-size: 12px;
  color: var(--pv-dsc-c);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ---- 小图标底板：70 / 圆角 18 / 图片内缩 68% / 名称在下 ---- */.pv-mic {
  width: 70px;
  height: 70px;
  border-radius: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #8a8e93;
  box-shadow: 0 6px 10px rgba(0, 0, 0, .18), 0 14px 26px rgba(0, 0, 0, .26);
}

/* 未设背景色：玻璃底板（同前台 .mic.plain），不能铺满实色 */
.pv-mic.plain {
  background: var(--pv-card-bg);
  border: 1px solid var(--pv-card-bd);
  box-shadow: 0 4px 16px rgba(0, 0, 0, .18);
}

.pv-mic img {
  width: 68%;
  height: 68%;
  object-fit: contain;
  border-radius: 9px;
}

.pv-mic span {
  max-width: 76%;
  font-weight: 700;
  letter-spacing: .5px;
  line-height: 1;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, .25);
}

/* 玻璃底板上白字看不见，浅色预览改深色字（前台同一规则） */
.pv-stage.light .pv-mic.plain span {
  color: #606266;
  text-shadow: none;
}

/* 底板下方名称：前台两个主题都固定白字 + 暗投影（背景图上看不清，只能靠投影压层次） */
.pv-mname {
  max-width: 92px;
  font-size: 14px;
  color: #fff;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 1px 8px rgba(0, 0, 0, .42), 0 2px 20px rgba(0, 0, 0, .28);
}

/* ---------- 顶部页签（添加卡片 / 添加组件）：扁平文字页签 ---------- */
.ed-tabs { display: flex; align-items: center; gap: 4px; }
/* 编辑态标题带图标：图标与文字基线对齐，颜色跟随标题文字 */
.ed-head { display: inline-flex; align-items: center; gap: 6px; }
.ed-tab {
  position: relative; padding: 4px 2px 8px; margin-right: 18px;
  border: 0; background: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 16px; font-weight: 600; line-height: 1.4;
  color: var(--el-text-color-secondary, #6b7480);
  transition: color .15s;
}
.ed-tab:hover { color: var(--el-text-color-primary, #1f2328); }
.ed-tab.on { color: var(--el-color-primary, #409eff); }
.ed-tab.on::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px;
  border-radius: 2px; background: var(--el-color-primary, #409eff);
}

/* ---------- 组件页 ---------- */
.wg-pane { padding: 4px 0 8px; }
.wg-tip { margin: 0 0 18px; font-size: 13px; color: var(--el-text-color-secondary, #6b7480); }
.wg-group { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
.wg-group-lb { flex: none; font-size: 13px; color: var(--el-text-color-regular, #4b5563); }

.wg-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.wg-card {
  display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
  padding: 16px 14px; text-align: left; cursor: pointer;
  border: 1px solid var(--el-border-color-lighter, rgba(0, 0, 0, .09));
  border-radius: 12px;
  background: var(--el-bg-color, #fff);
  transition: border-color .18s, box-shadow .18s, transform .1s;
}
.wg-card:hover {
  border-color: var(--el-color-primary, #409eff);
  box-shadow: 0 8px 20px rgba(64, 158, 255, .16);
}
.wg-card:active { transform: translateY(1px); }
.wg-ic {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 11px;
  color: var(--el-color-primary, #409eff);
  background: rgba(64, 158, 255, .12);
}
.wg-name { font-size: 14px; font-weight: 600; color: var(--el-text-color-primary, #1f2328); }
.wg-desc { font-size: 12px; line-height: 1.5; color: var(--el-text-color-secondary, #6b7480); }
.wg-add { margin-top: 2px; font-size: 12px; color: var(--el-color-primary, #409eff); }

/* 编辑组件卡片时的说明条 */
.wg-note {
  margin: 0 0 14px; padding: 9px 12px; border-radius: 9px;
  font-size: 12.5px; line-height: 1.6;
  color: var(--el-color-primary, #409eff);
  background: rgba(64, 158, 255, .10);
}
</style>
