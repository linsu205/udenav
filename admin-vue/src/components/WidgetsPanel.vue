<script setup lang="ts">
/**
 * 组件管理：内置组件（日历 / 备忘录 / 待办）的外观与功能设置。
 *
 * 配置按「组件类型」存（widget_cfg 表），不按卡片存：日历 / 备忘录 / 待办是内置的三种
 * 能力，不管有没有放到页面上，都该能在这里改图标、主色、描述与功能开关。
 * 卡片只是它们的「摆件」，位置、分组、拖拽、增删仍在「分组与卡片」页。
 *
 * 图标（内置三风格 / 在线 Iconify 名称）与开关的**可选值**来自 /api/public/widget-meta
 * —— 与前台渲染同一个源。页面上不硬编码任何图标路径，加一个预设只改 src/lib/widgets.ts。
 */
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { Refresh, RefreshLeft } from '@element-plus/icons-vue';
import { useStore } from '../store';
import { get, put } from '../api';
import { notifyHome } from '../lib/notify';
import ModalShell from './ModalShell.vue';
import IIcon from './IIcon.vue';

type Variant = { key: string; label: string };
type LibIcon = { key: string; label: string; dual: string; line: string; solid: string };
type Toggle = { key: string; label: string; hint: string; def: 0 | 1 };
type Preset = { type: 'builtin' | 'iconify'; variant?: string; name?: string; label: string };
type KindMeta = {
  kind: string; label: string; desc: string; icon: string;
  /** 默认风格：内置图标没配风格时用它（如换算器实心）。缺省 dual */
  defVariant?: string;
  presets: Preset[]; toggles: Toggle[];
};

const store = useStore();

/* meta 没拉到时的兜底默认色，与 src/lib/widgets.ts 的 WIDGET_DEFAULT_COLOR 一致 */
const FALLBACK_COLOR = '#409EFF';
const meta = ref<{ defaultColor: string; kinds: KindMeta[]; library: LibIcon[]; variants: Variant[] }>({ defaultColor: FALLBACK_COLOR, kinds: [], library: [], variants: [] });
const metaErr = ref(false);
const refreshing = ref(false);

/* 预设色：第一格是品牌蓝（logo 色，也就是默认值），其余用于区分不同组件。
   想用别的颜色走右边的取色器，不限制在这几个里面 */
const PRESETS = ['#409EFF', '#18A058', '#E6A23C', '#F56C6C', '#8B5CF6', '#0EA5E9', '#EC4899', '#64748B'];

const defaultColor = computed(() => meta.value.defaultColor || FALLBACK_COLOR);

/* 类型级配置：/api/admin/widget-cfgs 返回三类组件各一份，与卡片是否存在无关 */
type CfgRow = { title: string; description: string; cfg: string };
type Placed = { id: number; kind: string; title: string; groupId: number };
const cfgMap = ref<Record<string, CfgRow>>({});
const placed = ref<Placed[]>([]);
const cfgErr = ref(false);

type Row = { kind: string; label: string; title: string; desc: string; cfg: Cfg; count: number };

/* 行的来源是组件定义（meta.kinds），不是卡片列表 ——
   这就是「组件不管放不放都在这里管理」：没放到页面上的组件同样有三行。 */
const rows = computed<Row[]>(() =>
  meta.value.kinds.map((k) => {
    const saved = cfgMap.value[k.kind];
    return {
      kind: k.kind,
      label: k.label,
      title: saved?.title || k.label,
      desc: saved?.description || k.desc,
      cfg: parseCfg(saved?.cfg),
      count: placed.value.filter((x) => x.kind === k.kind).length,
    };
  }),
);

async function loadCfgs() {
  try {
    const r = await get<{ cfgs?: Record<string, CfgRow>; placed?: Placed[] }>('/api/admin/widget-cfgs');
    cfgMap.value = r?.cfgs || {};
    placed.value = r?.placed || [];
    cfgErr.value = false;
  } catch (e: any) {
    cfgErr.value = true;
    ElMessage.error('组件配置加载失败：' + (e?.message || '请重试'));
  }
}

function kindMeta(kind?: string): KindMeta | undefined {
  return meta.value.kinds.find((k) => k.kind === kind);
}

/* ---------------- 配置读写 ---------------- */

type Cfg = { icon: string; variant: string; color: string; opts: Record<string, number> };

function parseCfg(raw?: string): Cfg {
  let o: any = null;
  try { o = JSON.parse(raw || '{}'); } catch { o = null; }
  if (!o || typeof o !== 'object') o = {};
  let icon = String(o.icon || '');
  let variant = String(o.variant || '');
  /* 兼容旧配置：旧版把风格（dual/line/solid）存在 icon 里，没有图标库这个概念 */
  if (!variant && /^(dual|line|solid)$/.test(icon)) { variant = icon; icon = ''; }
  return {
    icon,
    variant,
    color: String(o.color || ''),
    opts: (o.opts && typeof o.opts === 'object') ? { ...o.opts } : {},
  };
}

/* 一个风格 key 的合法值；空串表示「跟默认」（dual） */
function normVariant(v?: string): 'dual' | 'line' | 'solid' {
  return v === 'line' || v === 'solid' ? v : 'dual';
}

/* 图标库查询：形状 + 风格 → 24×24 的内部标记。
   形状没配 → 该组件的默认图标；形状失效（库里删了）→ 也回退默认 */
function libOf(name?: string): LibIcon | undefined {
  const lib = meta.value.library;
  return lib.find((i) => i.key === name) || lib.find((i) => i.key === 'cal');
}
/* 在线图标名（Iconify）：后端入库前已按同一正则校验，这里只负责区分「内置 key」和「在线名」 */
const ICONIFY_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;
const isIconifyName = (v?: string) => ICONIFY_RE.test(String(v || '').trim());

/* 有效图标：没配过（空串）→ 元数据里的默认图标。calendar/memo/todo 的默认
   都是彩色 Iconify 图标（用户不设置就是这个样子），conv 默认是内置 key */
function effIcon(kind: string | undefined, icon: string | undefined): string {
  return (icon || '').trim() || kindMeta(kind)?.icon || '';
}

/* 预览/列表要画的图标：在线图标返回空串（改由 <IIcon> 渲染），内置图标返回 SVG 内部标记 */
function iconPath(kind: string | undefined, key: string | undefined, variant?: string): string {
  const eff = effIcon(kind, key);
  if (isIconifyName(eff)) return '';
  const ic = libOf(eff);
  if (!ic) return '';
  return ic[normVariant(variant || kindMeta(kind)?.defVariant)];
}

function rowColor(r: Row): string {
  return r.cfg.color || defaultColor.value;
}

/* 组件色淡底：把 #rrggbb 转成 rgba，用于图标底板，避免写死一堆半透明色值 */
function tint(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(64,158,255,${a})`;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/* ---------------- 加载 ---------------- */

/* 元数据是静态的（图标路径、开关定义），整个会话只拉一次就够；
   面板切来切去不重复请求，也免得公开接口被限流刷到 */
let metaPromise: Promise<any> | null = null;

async function loadMeta() {
  try {
    if (!metaPromise) metaPromise = get<any>('/api/public/widget-meta');
    const r = await metaPromise;
    if (r && Array.isArray(r.kinds)) {
      meta.value = {
        defaultColor: r.defaultColor || FALLBACK_COLOR,
        kinds: r.kinds || [],
        library: r.library || [],
        variants: r.variants || [],
      };
      metaErr.value = false;
    } else {
      metaErr.value = true;
    }
  } catch (e: any) {
    metaPromise = null;   // 失败不缓存，下次进页面还能重试
    metaErr.value = true;
    console.error('[widget-meta]', e);
    ElMessage.error('组件定义加载失败：' + (e?.message || '请重试'));
  }
}

async function refresh() {
  refreshing.value = true;
  try {
    await Promise.all([store.loadAll(), loadCfgs()]);   // 卡片与配置都可能被别的窗口改过
    ElMessage.success('已刷新');
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  loadMeta();
  loadCfgs();
});

/* ---------------- 节假日（只对日历组件显示） ----------------
   数据存在 D1 的 cal_day 表，前台日历据此画「休 / 班」角标。
   为什么放后台而不是写死在前端：每年放假通知都不一样，写死就得改代码发版本。
   保存语义是「整年覆盖」：只提交被改动过的年份，没动过的年份一个请求都不发。 */

const HOL_MODES = [
  { k: 'off', t: '休息日' },
  { k: 'work', t: '调休上班' },
  { k: 'erase', t: '清除' },
] as const;
type HolKind = 'off' | 'work';
type HolMode = HolKind | 'erase';

/* 按年缓存已加载/已编辑的安排。某年不在表里 = 还没拉过，不是「没有数据」，
   否则加载失败时用户随便点一下就会把服务器上那年整份覆盖成空 */
const holByYear = ref<Record<number, Record<string, HolKind>>>({});
const holDirty = ref<number[]>([]);
const holYear = ref(new Date().getFullYear());
const holMonth = ref(new Date().getMonth());
const holMode = ref<HolMode>('off');
const holErr = ref(false);

const holCur = computed(() => holByYear.value[holYear.value] || {});
const holLoaded = computed(() => !!holByYear.value[holYear.value]);
const holStat = computed(() => {
  let off = 0, work = 0;
  const v = holCur.value;
  for (const k of Object.keys(v)) v[k] === 'work' ? work++ : off++;
  return { off, work };
});

async function ensureHol(y: number) {
  if (holByYear.value[y]) return;
  holErr.value = false;
  try {
    const r = await get<{ days?: Record<string, HolKind> }>('/api/admin/cal-days?year=' + y);
    holByYear.value[y] = r?.days || {};
  } catch (e: any) {
    holErr.value = true;   // 不写空对象：写了下一次点击就会以空为基础整年覆盖
    ElMessage.error('节假日加载失败：' + (e?.message || '请重试'));
  }
}

function resetHol() {
  holByYear.value = {};
  holDirty.value = [];
  holErr.value = false;
  holYear.value = new Date().getFullYear();
  holMonth.value = new Date().getMonth();
}

function shiftHolYear(d: number) {
  holYear.value += d;
  ensureHol(holYear.value);
}
function shiftHolMonth(d: number) {
  const m = holMonth.value + d;
  if (m < 0) { holMonth.value = 11; holYear.value -= 1; ensureHol(holYear.value); }
  else if (m > 11) { holMonth.value = 0; holYear.value += 1; ensureHol(holYear.value); }
  else holMonth.value = m;
}

/* 当前月的格子：周一开头，前后补空格以对齐 7 列（和前台日历同一口径） */
const holGrid = computed(() => {
  const y = holYear.value, m = holMonth.value;
  const lead = (new Date(y, m, 1).getDay() + 6) % 7;
  const dim = new Date(y, m + 1, 0).getDate();
  const cells: Array<{ day: string; n: number; we: boolean }> = [];
  for (let i = 0; i < lead; i++) cells.push({ day: '', n: 0, we: false });
  for (let d = 1; d <= dim; d++) {
    const wd = new Date(y, m, d).getDay();
    cells.push({
      day: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      n: d,
      we: wd === 0 || wd === 6,
    });
  }
  while (cells.length % 7) cells.push({ day: '', n: 0, we: false });
  return cells;
});

function markDay(day: string) {
  if (!day) return;
  if (!holLoaded.value) { ElMessage.warning('节假日数据还没加载成功，请重开设置再试'); return; }
  const y = holYear.value;
  const obj = holByYear.value[y];
  const target: HolKind | '' = holMode.value === 'erase' ? '' : holMode.value;
  /* 再点一次同一种标记 = 取消，不用为了改一天切到「清除」 */
  if (!target || obj[day] === target) delete obj[day];
  else obj[day] = target;
  if (!holDirty.value.includes(y)) holDirty.value.push(y);
}

/* ---------------- 编辑弹窗 ---------------- */

type Draft = {
  kind: string;
  title: string;
  desc: string;
  icon: string;
  variant: string;
  color: string;
  opts: Record<string, number>;
};

const draft = ref<Draft | null>(null);
const saving = ref(false);
const editing = computed(() => !!draft.value);
const draftMeta = computed(() => kindMeta(draft.value?.kind));
/* 开关分两段显示：「权限」只放「不登录也能用」，其余都算「功能」。
   混在一列里会让人以为访客开关也是某种显示样式，而它其实决定「谁能用」 */
const toggleRows = computed(() => {
  const list = draftMeta.value?.toggles || [];
  const rows = [
    { label: '权限', list: list.filter((t) => t.key === 'guest') },
    { label: '功能', list: list.filter((t) => t.key !== 'guest') },
  ];
  return rows.filter((r) => r.list.length > 0);
});
/* 弹窗里实际预览用的风格：空值按该组件默认风格（如换算器实心）处理 */
const draftVariant = computed(() => normVariant(draft.value?.variant || draftMeta.value?.defVariant));

/* 图标输入框的本地缓冲。为什么不直接绑 draft.icon：
   draft.icon 同时承载「内置图标 key」和「在线图标名」两种值，而输入框只该显示后者；
   直接绑的话，内置图标（cal/memo/todo）会出现在输入框里，看着像填错了。
   输入过程中的半成品（还没打冒号、带空格）也只留在缓冲里，不往配置里写脏值。 */
const iconBuf = ref('');
const iconBufOk = computed(() => isIconifyName(iconBuf.value));
const iconBufBad = computed(() => !!iconBuf.value.trim() && !iconBufOk.value);

function onIconInput(v: string) {
  iconBuf.value = v;
  const t = String(v || '').trim();
  if (!draft.value) return;
  if (!t) { draft.value.icon = ''; return; }      // 清空 = 回到内置默认图标
  if (isIconifyName(t)) draft.value.icon = t;     // 合法才落进配置，半成品先只留在缓冲
}

/* 按组件类型打开设置：行的来源是类型，不是某张卡片 */
function openEdit(kind: string) {
  const r = rows.value.find((x) => x.kind === kind);
  const cfg = r?.cfg || parseCfg('');
  draft.value = {
    kind,
    title: r?.title || kindMeta(kind)?.label || '',
    desc: r?.desc || '',
    icon: cfg.icon,
    variant: cfg.variant,
    color: cfg.color,
    opts: cfg.opts,
  };
  iconBuf.value = isIconifyName(cfg.icon) ? cfg.icon : '';
  /* 每次打开都从库里重拉节假日：别把上次未保存的涂改带进来 */
  resetHol();
  if (kind === 'calendar') ensureHol(holYear.value);
}

/* 关闭弹窗（取消/点 ×）：草稿和未提交的节假日改动一起丢弃 */
function closeEdit() {
  draft.value = null;
  iconBuf.value = '';
  resetHol();
}

/* 点预设图标：
   - 内置三风格 → icon 存空串（= 跟随该组件默认图标）、variant 存风格；
     与默认风格相同的存空串（继续跟随默认），不同的显式存下来。
   - 在线图标 → icon 存 Iconify 名称，variant 保留但不再生效（彩色图标不套风格）。 */
function pickPreset(p: Preset) {
  const d = draft.value;
  if (!d) return;
  if (p.type === 'iconify' && p.name) {
    d.icon = p.name;
    iconBuf.value = p.name;
    return;
  }
  d.icon = '';
  d.variant = p.variant && p.variant !== (draftMeta.value?.defVariant || 'dual') ? p.variant : '';
  iconBuf.value = '';
}
function presetOn(p: Preset): boolean {
  const d = draft.value;
  if (!d) return false;
  /* 彩色预设：配过看配的值；没配过时默认图标恰好就是它也算选中（比如日历默认彩色） */
  if (p.type === 'iconify') return d.icon ? d.icon === p.name : effIcon(d.kind) === p.name;
  return !isIconifyName(effIcon(d.kind, d.icon)) && draftVariant.value === normVariant(p.variant);
}
/* 弹窗里那把「恢复默认」小刷子：只重置图标与风格（主色、开关不动） */
function resetIcon() {
  const d = draft.value;
  if (!d) return;
  d.icon = '';
  d.variant = '';
  iconBuf.value = '';
}

/* 开关值：库里存过 0/1 就用它，没存过用元数据里的默认值。
   el-switch 要布尔，所以这里做一次 0/1 → true/false 的翻译 */
function optOn(key: string): boolean {
  const d = draft.value;
  if (!d) return false;
  const v = d.opts[key];
  if (v === 0 || v === 1) return v === 1;
  const t = draftMeta.value?.toggles.find((x) => x.key === key);
  return !!t?.def;
}
function setOpt(key: string, val: boolean) {
  if (draft.value) draft.value.opts[key] = val ? 1 : 0;
}

/* 恢复默认：只重置弹窗里的表单，点保存才真正写库 ——
   直接落库的话「点错了」就没有反悔余地 */
function resetDraft() {
  const d = draft.value;
  if (!d) return;
  d.icon = '';
  d.variant = '';
  d.color = '';
  d.opts = {};
  iconBuf.value = '';
  ElMessage.info('已恢复默认，点保存后生效');
}

async function save() {
  const d = draft.value;
  if (!d) return;
  const title = d.title.trim();
  if (!title) { ElMessage.warning('名称不能为空'); return; }
  /* 输入框里留了不合法的名字就不许存：存进去前台只会是一个破图 */
  const iconName = iconBuf.value.trim();
  if (iconName && !isIconifyName(iconName)) {
    ElMessage.warning('图标名格式应为「前缀:图标名」，如 flat-color-icons:calendar');
    return;
  }
  if (iconName) d.icon = iconName;
  saving.value = true;
  const cfgStr = (() => {
    const hasOpts = Object.keys(d.opts).length > 0;
    if (!d.icon && !d.variant && !d.color && !hasOpts) return '';   // 全默认就存空串，前端省一层解析
    return JSON.stringify({ icon: d.icon, variant: d.variant, color: d.color, opts: d.opts });
  })();
  const desc = d.desc.trim() || (draftMeta.value?.desc || '');
  try {
    await put('/api/admin/widget-cfgs/' + d.kind, {
      title,
      description: d.desc.trim(),
      cfg: cfgStr,
    });
    /* 节假日按年整份覆盖：只提交真的动过的年份 */
    if (holDirty.value.length) {
      for (const y of holDirty.value) {
        await put('/api/admin/cal-days', { year: y, days: holByYear.value[y] || {} });
      }
      holDirty.value = [];
    }
    cfgMap.value = { ...cfgMap.value, [d.kind]: { title, description: desc, cfg: cfgStr } };
    /* 卡片标题/描述后端已一并更新；这里就地改 store，省一次重拉（重拉会让列表闪一下） */
    for (const g of store.groups) {
      for (const it of (g.items || [])) {
        if (it.kind === d.kind) {
          it.title = title;
          it.description = desc;
          it.w_cfg = '';   // 配置改由类型级下发，卡片上那份老值不再使用
        }
      }
    }
    notifyHome();   // 前台按新配置重渲染卡片与面板
    ElMessage.success('已保存，前台已同步');
    closeEdit();
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败，请重试');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>组件管理</h2>
        <div class="sub">
          内置组件的外观与功能
        </div>
      </div>
      <div class="head-right">
        <el-button :loading="refreshing" @click="refresh">
          <el-icon class="btn-ico"><Refresh /></el-icon>刷新
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="metaErr" type="warning" :closable="false" show-icon class="meta-warn"
      title="组件定义没取到，图标预览与功能项可能不全（已保存的配置不会丢）"
    />
    <el-alert
      v-if="cfgErr" type="warning" :closable="false" show-icon class="meta-warn"
      title="组件配置没取到，下面显示的是默认值；此时保存会覆盖已有配置，建议先点刷新"
    />

    <div v-if="!rows.length" class="empty">
      <div class="empty-ic">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <rect x="3" y="3.3" width="18" height="17.4" rx="4.4" fill-opacity=".2" />
          <rect x="3" y="3.3" width="18" height="17.4" rx="4.4" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M7.4 12 10.8 15.4 17.1 8.9" fill="none" stroke="currentColor" stroke-width="2.5"
                stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
      <p class="empty-t">组件定义没加载到</p>
      <p class="empty-s">这是接口没回来的情况，不是「没有组件」；点右上角刷新重试。</p>
    </div>

    <div v-else class="wlist">
      <div v-for="r in rows" :key="r.kind" class="wrow">
        <div class="wic" :style="{ background: tint(rowColor(r), 0.12), color: rowColor(r) }">
          <!-- 内置图标：路径来自后端元数据（v-html 塞进 svg 内部）；在线图标（含默认的彩色图标）：交给 IIcon 取原图 -->
          <IIcon v-if="isIconifyName(effIcon(r.kind, r.cfg.icon))" :name="effIcon(r.kind, r.cfg.icon)" :size="20" />
          <svg
            v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
            v-html="iconPath(r.kind, r.cfg.icon, r.cfg.variant)"
          />
        </div>

        <div class="wmain">
          <div class="wtitle">
            <span class="wname">{{ r.title }}</span>
            <!-- 名称没改过时它就等于类型名，再挂个类型标签等于写两遍 -->
            <span v-if="r.title !== r.label" class="wkind">{{ r.label }}</span>
            <!-- 放置状态：组件是「内置能力」，放不放到页面上都能在这里管理 -->
            <span class="wstat" :class="{ off: !r.count }">
              {{ r.count ? (r.count > 1 ? `已放置 ${r.count} 处` : '已放置') : '未放置' }}
            </span>
          </div>
          <div class="wdesc">{{ r.desc || '未填写描述' }}</div>
        </div>

        <div class="wacts">
          <el-button size="small" @click="openEdit(r.kind)">设置</el-button>
        </div>
      </div>
    </div>

    <!-- 设置弹窗 -->
    <ModalShell v-if="editing && draft" title="组件设置" width="540px" @close="closeEdit">
      <div class="fm">
        <div class="fm-row">
          <label class="fm-label">名称</label>
          <el-input v-model="draft.title" maxlength="20" show-word-limit placeholder="卡片上显示的名称" />
        </div>

        <div class="fm-row">
          <label class="fm-label">描述</label>
          <el-input
            v-model="draft.desc" maxlength="40" show-word-limit
            placeholder="显示在卡片名称下方，如「公历 + 农历」"
          />
        </div>

        <div class="fm-row">
          <label class="fm-label">图标</label>
          <div>
            <!-- 和「分组图标」同一套交互：左边预览、中间填在线图标名、右边一键回默认；
                 下面一排预设（内置三种风格 + 一个彩色图标），点一下就换。
                 预览画的就是前台会画的东西（内置图标按主色 + 当前风格，在线图标取原图）。 -->
            <div class="wico">
              <div class="wico-box" :class="{ bad: iconBufBad }" :style="{ '--c': draft.color || defaultColor }">
                <IIcon v-if="iconBufOk" :name="iconBuf.trim()" :size="20" />
                <IIcon
                  v-else-if="isIconifyName(effIcon(draft.kind, draft.icon))"
                  :name="effIcon(draft.kind, draft.icon)" :size="20"
                />
                <svg
                  v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                  v-html="iconPath(draft.kind, draft.icon, draft.variant)"
                />
              </div>
              <el-input
                :model-value="iconBuf"
                clearable
                placeholder="在线图标名，如 flat-color-icons:calendar（留空 = 内置图标）"
                @update:model-value="onIconInput"
              />
              <el-button class="wico-reset" :icon="RefreshLeft" title="恢复默认图标" @click="resetIcon" />
            </div>

            <div class="wico-quick">
              <button
                v-for="(p, i) in (draftMeta?.presets || [])" :key="i" type="button"
                class="p-btn" :class="{ on: presetOn(p) }"
                :style="{ '--c': draft.color || defaultColor }"
                :title="p.type === 'iconify' ? p.name : '内置图标 · ' + p.label"
                @click="pickPreset(p)"
              >
                <IIcon v-if="p.type === 'iconify'" :name="p.name || ''" :size="20" />
                <svg
                  v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"
                  v-html="iconPath(draft.kind, draftMeta?.icon, p.variant)"
                />
                <span>{{ p.label }}</span>
              </button>
            </div>
            <div v-if="!draftMeta?.presets?.length" class="hint-dim">预设图标没加载到，稍后重试或点右上角刷新</div>
            <div v-if="iconBufBad" class="hint-bad">格式应为「前缀:图标名」，如 flat-color-icons:calendar；不够用就去 iconify.design 查名字</div>
          </div>
        </div>

        <div class="fm-row">
          <label class="fm-label">主色</label>
          <div class="colors">
            <button
              v-for="c in PRESETS" :key="c" type="button" class="c-dot"
              :class="{ on: (draft.color || defaultColor).toLowerCase() === c.toLowerCase() }"
              :style="{ background: c }" :title="c" @click="draft.color = c === defaultColor ? '' : c"
            />
            <el-color-picker v-model="draft.color" size="small" :predefine="PRESETS" />
            <span class="c-tip">{{ draft.color || defaultColor }}{{ draft.color ? '' : '（默认）' }}</span>
          </div>
        </div>

        <div v-for="row in toggleRows" :key="row.label" class="fm-row">
          <label class="fm-label">{{ row.label }}</label>
          <div class="toggles">
            <div v-for="t in row.list" :key="t.key" class="tg">
              <div class="tg-txt">
                <span class="tg-t">{{ t.label }}</span>
                <span class="tg-h">{{ t.hint }}</span>
              </div>
              <el-switch :model-value="optOn(t.key)" @update:model-value="(v: any) => setOpt(t.key, !!v)" />
            </div>
          </div>
        </div>

        <!-- 节假日只有日历用得着：放着别的组件也能设置，会让人以为它会影响什么 -->
        <div v-if="draft.kind === 'calendar'" class="fm-row">
          <label class="fm-label">节假日</label>
          <div class="hol">
            <div class="hol-bar">
              <div class="hol-pill">
                <button type="button" class="hol-ar" aria-label="上一年" @click="shiftHolYear(-1)">‹</button>
                <b>{{ holYear }} 年</b>
                <button type="button" class="hol-ar" aria-label="下一年" @click="shiftHolYear(1)">›</button>
              </div>
              <div class="hol-pill">
                <button type="button" class="hol-ar" aria-label="上个月" @click="shiftHolMonth(-1)">‹</button>
                <b>{{ holMonth + 1 }} 月</b>
                <button type="button" class="hol-ar" aria-label="下个月" @click="shiftHolMonth(1)">›</button>
              </div>
              <span class="hol-sum">休 {{ holStat.off }} · 班 {{ holStat.work }}</span>
            </div>

            <div class="hol-week">
              <span v-for="w in ['一','二','三','四','五','六','日']" :key="w" :class="{ we: w === '六' || w === '日' }">{{ w }}</span>
            </div>
            <div class="hol-grid">
              <!-- 补位格没有日期：写成 '' 而不是 c.n（那是 0，网格上会冒出一排 0） -->
        <button
                v-for="(c, i) in holGrid" :key="i" type="button"
                class="hd" :class="[c.we ? 'we' : '', c.day ? (holCur[c.day] || '') : 'blank']"
                :disabled="!c.day || !holLoaded" @click="markDay(c.day)"
              >{{ c.day ? c.n : '' }}</button>
            </div>

            <div class="hol-foot">
              <div class="hol-modes">
                <button
                  v-for="m in HOL_MODES" :key="m.k" type="button"
                  class="hol-m" :class="[{ on: holMode === m.k }, 'k-' + m.k]" @click="holMode = m.k"
                >{{ m.t }}</button>
              </div>
              <span class="hol-hint">{{ holErr ? '加载失败，请重开设置' : '点日期打标记，再点一次取消' }}</span>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="resetDraft">恢复默认</el-button>
        <el-button @click="closeEdit">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </ModalShell>
  </div>
</template>

<style scoped>
  .head-right { display: flex; align-items: center; gap: 10px; }
  .btn-ico { margin-right: 5px; }
  .meta-warn { margin-bottom: 12px; }

  /* 组件行：一行一张，和「分组与卡片」的列表同一套视觉（白底卡 + 细分隔） */
  .wlist { display: flex; flex-direction: column; gap: 10px; }
  .wrow {
    display: flex; align-items: center; gap: 14px;
    padding: 13px 16px; border-radius: 12px;
    background: var(--sp-card); border: 1px solid var(--sp-card-border);
    transition: border-color .15s, box-shadow .15s;
  }
  .wrow:hover { border-color: rgba(var(--sp-accent-rgb), .38); box-shadow: 0 4px 16px rgba(0, 0, 0, .05); }
  .wic {
    flex: 0 0 46px; width: 46px; height: 46px; border-radius: 13px;
    display: flex; align-items: center; justify-content: center;
  }
  .wic svg { width: 28px; height: 28px; display: block; }

  .wmain { flex: 1; min-width: 0; }
  .wtitle { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wname { font-size: 14.5px; font-weight: 600; color: var(--sp-text); }
  /* 类型标签刻意做灰：名称默认就叫「日历」，标签再用品牌蓝会和名称抢眼、
     看起来像重复了两遍。灰底只是提示「这行是哪种组件」 */
  .wkind {
    font-size: 11px; padding: 1px 7px; border-radius: 6px;
    color: var(--sp-dim); background: rgba(128, 128, 128, .12);
  }
  /* 放置状态：已放置走中性灰，「未放置」用淡蓝提示「还没放到页面上，但可以配」 */
  .wstat {
    font-size: 11px; padding: 1px 7px; border-radius: 6px;
    color: var(--sp-accent); background: var(--sp-accent-soft);
  }
  .wstat.off { color: var(--sp-dim); background: rgba(128, 128, 128, .1); }
  .wdesc {
    margin-top: 4px; font-size: 12.5px; color: var(--sp-dim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .wacts { flex: 0 0 auto; }

  /* 空态 */
  .empty {
    display: flex; flex-direction: column; align-items: center;
    padding: 56px 20px; border-radius: 12px;
    background: var(--sp-card); border: 1px dashed var(--sp-border);
  }
  .empty-ic { color: var(--sp-dim); opacity: .3; }
  .empty-ic svg { width: 56px; height: 56px; display: block; }
  .empty-t { margin: 14px 0 4px; font-size: 14px; font-weight: 600; color: var(--sp-text); }
  .empty-s { margin: 0; font-size: 12.5px; color: var(--sp-dim); text-align: center; }

  /* 表单 */
  .fm { display: flex; flex-direction: column; gap: 18px; padding: 6px 0 4px; }
  .fm-row { display: flex; gap: 14px; align-items: flex-start; }
  .fm-label {
    flex: 0 0 48px; padding-top: 7px;
    font-size: 13px; font-weight: 600; color: var(--sp-text);
  }
  .fm-row > :not(.fm-label) { flex: 1; min-width: 0; }

  /* 图标：预览块 + 名称输入 + 恢复默认，下面一排预设（与「分组图标」一致的交互） */
  .wico { display: flex; align-items: center; gap: 10px; width: 100%; }
  .wico :deep(.el-input) { min-width: 0; }
  .wico-box {
    flex: none; width: 34px; height: 34px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    color: var(--c, #409EFF); background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .wico-box svg { width: 20px; height: 20px; display: block; }
  .wico-box.bad { border-color: var(--sp-danger-text); }
  .wico-reset { flex: none; }

  .wico-quick { display: flex; flex-wrap: wrap; gap: 8px; width: 100%; margin-top: 10px; }
  .p-btn {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 11px 6px 9px; cursor: pointer;
    border: 1.5px solid var(--sp-border); border-radius: 9px;
    background: var(--sp-card-in, transparent); color: var(--c, #409EFF);
    transition: border-color .15s, background .15s;
  }
  .p-btn svg { width: 19px; height: 19px; display: block; }
  .p-btn span { font-size: 12px; color: var(--sp-dim); white-space: nowrap; }
  .p-btn:hover { border-color: rgba(var(--sp-accent-rgb), .5); }
  .p-btn.on { border-color: var(--sp-accent); background: var(--sp-accent-soft); }
  .p-btn.on span { color: var(--sp-accent); font-weight: 600; }

  .hint-bad { margin-top: 6px; font-size: 11.5px; color: var(--sp-danger-text); }

  .hint-dim { font-size: 11.5px; color: var(--sp-dim); }

  .colors { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .c-dot {
    width: 22px; height: 22px; border-radius: 50%; cursor: pointer;
    border: 2px solid transparent; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08);
    transition: transform .12s, border-color .12s;
  }
  .c-dot:hover { transform: scale(1.08); }
  .c-dot.on { border-color: var(--sp-text); }
  .c-tip { font-size: 11.5px; color: var(--sp-dim); }

  .toggles { display: flex; flex-direction: column; gap: 12px; }
  .tg { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .tg-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .tg-t { font-size: 13px; color: var(--sp-text); }
  .tg-h { font-size: 11.5px; color: var(--sp-dim); }

  /* 节假日：年份/月份胶囊 + 月历网格 + 笔刷模式，跟前台日历同一套视觉语言 */
  .hol { display: flex; flex-direction: column; gap: 8px; }
  .hol-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .hol-pill {
    display: flex; align-items: center;
    border: 1px solid var(--sp-border); border-radius: 8px;
    background: var(--sp-card-in);
  }
  .hol-pill b { min-width: 52px; text-align: center; font-size: 12.5px; font-weight: 600; color: var(--sp-text); }
  .hol-ar {
    width: 22px; height: 26px; padding: 0; border: 0; border-radius: 7px;
    background: transparent; color: var(--sp-dim); font-size: 14px; line-height: 1; cursor: pointer;
  }
  .hol-ar:hover { background: var(--sp-accent-soft); color: var(--sp-accent); }
  .hol-sum { margin-left: auto; font-size: 11.5px; color: var(--sp-dim); }

  .hol-week, .hol-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .hol-week span { text-align: center; font-size: 10.5px; color: var(--sp-dim); }
  .hol-week span.we { color: var(--sp-danger-text); }
  .hd {
    height: 32px; padding: 0; border: 0; border-radius: 7px;
    background: transparent; color: var(--sp-text);
    font-size: 12.5px; font-family: inherit; cursor: pointer;
    transition: background .12s, color .12s;
  }
  .hd.we { color: var(--sp-danger-text); }
  .hd.blank { cursor: default; }
  .hd:hover:not(.blank):not(:disabled) { background: rgba(128, 128, 128, .16); }
  .hd:disabled { cursor: default; }
  /* 休：红底红字（法定放假的整体色块）；班：灰底加粗（调休上班） */
  .hd.off, .hd.off.we { background: rgba(229, 72, 77, .15); color: var(--sp-danger-text); font-weight: 700; }
  .hd.work { background: rgba(128, 128, 128, .22); color: var(--sp-text); font-weight: 700; }

  .hol-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .hol-modes { display: flex; gap: 6px; }
  .hol-m {
    height: 25px; padding: 0 10px;
    border: 1px solid var(--sp-border); border-radius: 7px;
    background: transparent; color: var(--sp-dim);
    font-size: 12px; font-family: inherit; cursor: pointer;
    transition: border-color .12s, background .12s, color .12s;
  }
  .hol-m:hover { border-color: var(--sp-border-hover); color: var(--sp-text); }
  .hol-m.on { font-weight: 600; }
  .hol-m.k-off.on { border-color: var(--sp-danger); background: rgba(229, 72, 77, .12); color: var(--sp-danger-text); }
  .hol-m.k-work.on { border-color: var(--sp-dim); background: rgba(128, 128, 128, .16); color: var(--sp-text); }
  .hol-m.k-erase.on { border-color: var(--sp-accent); background: var(--sp-accent-soft); color: var(--sp-accent); }
  .hol-hint { font-size: 11px; color: var(--sp-dim); }
</style>
