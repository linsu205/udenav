<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { useStore, type Group, type IconItem } from '../store';
import { post, get, patch, del } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Edit, Delete, Rank, ArrowRight, Loading } from '@element-plus/icons-vue';
import { notifyHome } from '../lib/notify';
import { iconSrc } from '../lib/icon-color';
import GroupEditModal from './GroupEditModal.vue';
import IconEditModal from './IconEditModal.vue';
import IIcon from './IIcon.vue';

const store = useStore();
const gEdit = ref<Group | null | 'new'>(null);
const iEdit = ref<{ gid: number; it: IconItem | null } | null>(null);
const dragSrc = ref<{ kind: 'group' | 'icon'; id: number; gid?: number } | null>(null);

/* 列表图标文字：填了「图标文字」就显示它（截 4 字宽，同前台），否则标题首字。
   之前恒取标题首字，哔哩哔哩填了「B站」列表仍显示「哔」，用户对比出来了 */
const WIDE_CHAR = /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000\u2026]/;

/* 打开方式标签文案，和编辑弹窗里的下拉选项一一对应 */
const OPEN_LABEL: Record<number, string> = { 1: '当前页打开', 2: '新标签打开', 3: '弹窗打开' };

function listPlateText(it: IconItem): string {
  const t = String(it.icon_text || '').trim();
  if (t) {
    let out = '', u = 0;
    for (const ch of t) {
      const w = WIDE_CHAR.test(ch) ? 1 : 0.5;
      if (u + w > 4) break;
      out += ch; u += w;
    }
    return out;
  }
  return (it.title || '?').charAt(0).toUpperCase();
}

/* 列表图标块 46px：字宽单位 × 字号超过可用宽（40px，左右各留 3px）就缩字号，不换行 */function listPlateFs(it: IconItem): string {
  const t = listPlateText(it);
  let u = 0; for (const ch of t) u += WIDE_CHAR.test(ch) ? 1 : 0.5;
  return Math.min(16, 40 / Math.max(1, u)).toFixed(1) + 'px';
}

/* 分组默认收起：只记录被点开的组，没点过的都是收着的，可同时开几个 */
const opened = ref<number[]>([]);
const isClosed = (id: number) => !opened.value.includes(id);
function toggleGroup(id: number) {
  opened.value = isClosed(id) ? [...opened.value, id] : opened.value.filter(x => x !== id);
}

onMounted(() => {
  if (!store.groups.length) store.loadAll();
  /* 巡检结论不阻塞页面：拿到就铺上去，失败就当没有 */
  loadWatch();
});

/* 关闭卡片编辑弹窗。前台右键走的是一条完全独立的路径（见 EditApp.vue），
   不经过后台面板，这里只管后台「分组与卡片」页里自己的弹窗 */
function closeEdit() {
  iEdit.value = null;
}

async function saveGroup(g: Partial<Group> & { title: string }) {
  const isNew = gEdit.value === 'new';
  try {
    if (isNew) await post('/api/admin/groups', g);
    else await patch('/api/admin/groups/' + gEdit.value!.id, g);
  } catch (e: any) {
    ElMessage.error(e?.message || '保存失败，请重试');
    return; /* 保留弹窗和已填内容，别让用户白填 */
  }
  gEdit.value = null;
  await store.loadAll();
  /* 新建的分组默认排在最后，自动展开便于接着填卡片 */
  if (isNew) {
    const last = store.groups[store.groups.length - 1];
    if (last) opened.value = [...opened.value, last.id];
  }
  notifyHome();
  ElMessage.success('已保存，前台已同步');
}

async function saveIcon(it: Partial<IconItem> & { title: string; url: string }) {
  /* 保存失败必须显式提示：之前 saveIcon 没有 catch，后端报错（如缺列）会变成
     unhandled rejection，弹窗不关也不报错，用户只看到「点保存没反应」 */
  try {
    if (iEdit.value!.it) await patch('/api/admin/icons/' + iEdit.value!.it.id, it);
    else await post('/api/admin/icons', { ...it, group_id: iEdit.value!.gid });
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '请稍后重试'));
    return; /* 保留弹窗和已填内容 */
  }
  closeEdit();
  await store.loadAll();
  notifyHome();
  ElMessage.success('已保存，前台已同步');
}

async function delGroup(id: number) {
  await ElMessageBox.confirm('删除该分组及其全部卡片？', '确认删除', { type: 'warning', lockScroll: false });
  await del('/api/admin/groups/' + id);
  await store.loadAll();
  opened.value = opened.value.filter(x => x !== id);
  notifyHome();
  ElMessage.success('已删除，前台已同步');
}

async function delIcon(id: number) {
  await ElMessageBox.confirm('删除此卡片？', '确认删除', { type: 'warning', lockScroll: false });
  await del('/api/admin/icons/' + id);
  await store.loadAll();
  notifyHome();
  ElMessage.success('已删除，前台已同步');
}

function onDragStart(kind: 'group' | 'icon', id: number, gid?: number, e?: DragEvent) {
  /* 卡片行嵌在可拖动的分组卡里，dragstart 会冒泡到分组处理器，
     把 dragSrc 覆盖成 group → 卡片拖动永远失效。必须掐断冒泡。 */
  if (e) e.stopPropagation();
  dragSrc.value = { kind, id, gid };
}

async function onDrop(targetKind: 'group' | 'icon', targetId: number, targetGid?: number) {
  const src = dragSrc.value;
  dragSrc.value = null;
  if (!src || src.kind !== targetKind) return;
  if (targetKind === 'icon' && src.gid !== targetGid) return;
  if (src.id === targetId) return;
  if (targetKind === 'group') {
    const s = store.groups.find(g => g.id === src.id);
    const t = store.groups.find(g => g.id === targetId);
    if (!s || !t) return;
    await patch('/api/admin/groups/' + s.id, { sort: t.sort });
    await patch('/api/admin/groups/' + t.id, { sort: s.sort });
  } else {
    const g = store.groups.find(x => x.id === targetGid);
    const items = g?.items || [];
    const s = items.find(x => x.id === src.id);
    const t = items.find(x => x.id === targetId);
    if (!s || !t) return;
    await patch('/api/admin/icons/' + s.id, { sort: t.sort });
    await patch('/api/admin/icons/' + t.id, { sort: s.sort });
  }
  await store.loadAll();
  notifyHome();
  ElMessage.success('已排序，前台已同步');
}

const dragClass = (kind: 'group' | 'icon') => ({ 'drag-target': dragSrc.value?.kind === kind });

/* ---------------- 链接检查（按分组） ----------------
   检查按钮落在每个分组的标题行右侧，点它只查这一组的地址，不再全站扫一遍。
   后端代请求（浏览器跨域读不到状态码）；每批 20 条串行提交，边查边出结果。
   只查外网地址（it.url）—— 内网地址（it.lan_url）在 Cloudflare 侧不可达，
   查了必然全红，纯噪音，所以单独留空不查。
   结果只存在当前页面（不落库），再点一次即覆盖本组旧结果。 */
interface LinkState {
  level: 'ok' | 'warn' | 'bad';
  status: number;
  ms: number;
  error?: string;
  auto?: boolean;      // true = 来自 cron 巡检（存在后端），false/空 = 本次手动检查的临时结果
  at?: number;         // 自动结果的检查时间（秒）
  streak?: number;     // 连续失败次数
}
const linkMap = reactive<Record<number, LinkState>>({});          // key = 卡片 id
const runMap = reactive<Record<number, { done: number; total: number }>>({}); // key = 分组 id（进行中）
const checkedSet = reactive<Record<number, boolean>>({});          // 分组 id → 是否查过

/* 这一组要查的卡片：只有填了外网地址的；分组被隐藏（card_style=hide）也照查，后台仍要能发现死链 */
function checkableItems(g: Group) {
  return (g.items || []).filter((it) => !!it.url);
}

/* 本组已有的检查结果统计 */
function groupStat(g: Group) {
  const list = checkableItems(g);
  let ok = 0, warn = 0, bad = 0, n = 0;
  for (const it of list) {
    const s = linkMap[it.id];
    if (!s) continue;
    n++;
    if (s.level === 'ok') ok++;
    else if (s.level === 'warn') warn++;
    else bad++;
  }
  return { total: list.length, n, ok, warn, bad };
}

/* 最差的那一级决定整体颜色：有异常标红，只有受限标橙，全绿才绿 */
function groupLevel(g: Group): '' | 'ok' | 'warn' | 'bad' {
  const s = groupStat(g);
  if (!s.n) return '';
  if (s.bad) return 'bad';
  if (s.warn) return 'warn';
  return 'ok';
}

const isRunning = (g: Group) => !!runMap[g.id];

function groupCheckText(g: Group): string {
  const run = runMap[g.id];
  if (run) return `检查中 ${run.done}/${run.total}`;
  const s = groupStat(g);
  if (!checkedSet[g.id] || !s.total) return '检查链接';
  if (s.bad) return `异常 ${s.bad}`;
  if (s.warn) return `受限 ${s.warn}`;
  return '全部正常';
}

function groupCheckTitle(g: Group): string {
  const run = runMap[g.id];
  if (run) return `正在检查本组外网链接 ${run.done}/${run.total}`;
  const s = groupStat(g);
  if (!checkedSet[g.id] || !s.total) {
    return s.total ? `检查本组 ${s.total} 个外网链接（不查内网）` : '本组没有外网地址可查';
  }
  const head = `共 ${s.total} 条：正常 ${s.ok}，受限 ${s.warn}，异常 ${s.bad}`;
  return `${head}\n点击重新检查（只查外网）`;
}

async function checkGroup(g: Group) {
  if (runMap[g.id]) return;                      // 防重入：连点不会发两轮
  const list = checkableItems(g);
  if (!list.length) return ElMessage.warning('这一组没有外网地址可查');

  const items = list.map((it) => ({ id: it.id, url: it.url }));
  for (const it of list) delete linkMap[it.id];  // 先清本组旧结果，避免新旧混着看
  runMap[g.id] = { done: 0, total: items.length };

  const BATCH = 20;
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const r = await post<any>('/api/admin/linkcheck', { items: items.slice(i, i + BATCH) });
      for (const res of r.results || []) {
        linkMap[res.id] = { level: res.level, status: res.status, ms: res.ms, error: res.error };
      }
      runMap[g.id] = { done: Math.min(items.length, i + BATCH), total: items.length };
    }
    checkedSet[g.id] = true;
    const s = groupStat(g);
    if (s.bad || s.warn) {
      ElMessage.warning(`「${g.title}」${s.bad} 条异常、${s.warn} 条受限（共 ${s.total} 条）`);
    } else {
      ElMessage.success(`「${g.title}」${s.total} 条外网链接全部正常`);
    }
  } catch (e: any) {
    ElMessage.error('检查失败：' + (e?.message || '未知错误'));
  } finally {
    delete runMap[g.id];
  }
}

/* ---------- 自动巡检（cron 每小时查一小批，结果存在后端 link_status） ----------
   打开页面就把上次巡检结论铺到列表上：分组标题直接显示「异常 N」，
   不用先手动点一遍才知道哪个组有死链。手动检查仍可覆盖本次展示。 */
interface WatchItem {
  id: number; title: string; url: string; group_id: number;
  level: string; status: number; ms: number; fail_streak: number; error: string; checked_at: number;
}
const watchLast = ref({ at: 0, checked: 0, bad: 0 });
const watchFailed = ref<WatchItem[]>([]);
const watchOpen = ref(false);
const watchRunning = ref(false);

function tsText(ts: number): string {
  if (!ts) return '还没有跑过';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadWatch() {
  try {
    const r = await get<any>('/api/admin/link-status');
    watchLast.value = r.last || { at: 0, checked: 0, bad: 0 };
    const items: WatchItem[] = Array.isArray(r.items) ? r.items : [];
    /* 直接复用现有的 linkMap 色标与分组统计，模板不用另写一套渲染 */
    for (const it of items) {
      linkMap[it.id] = {
        level: it.level as LinkState['level'],
        status: it.status,
        ms: it.ms || 0,
        error: it.error || undefined,
        auto: true,
        at: it.checked_at,
        streak: it.fail_streak,
      };
      /* 有巡检结论的组才算「已查过」，否则组头仍显示「检查链接」 */
      if (it.group_id) checkedSet[it.group_id] = true;
    }
    watchFailed.value = items.filter((x) => x.level === 'bad' && x.fail_streak >= 3);
  } catch {
    /* 巡检接口异常不该让整个页面打不开：静默降级成「没有巡检数据」 */
  }
}

async function runWatchNow() {
  if (watchRunning.value) return;
  watchRunning.value = true;
  try {
    const r = await post<any>('/api/admin/link-status/run', {});
    await loadWatch();
    const n = Number(r?.checked) || 0;
    const bad = Number(r?.bad) || 0;
    if (!n) ElMessage.success('这一轮没有需要检查的链接（都刚查过）');
    else if (bad) ElMessage.warning(`巡检完成：查了 ${n} 条，其中 ${bad} 条异常`);
    else ElMessage.success(`巡检完成：查了 ${n} 条，全部正常`);
  } catch (e: any) {
    ElMessage.error('巡检失败：' + (e?.message || '未知错误'));
  } finally {
    watchRunning.value = false;
  }
}

/* 点失效条目直接打开那张卡片的编辑弹窗，省得自己翻分组 */
function openFailed(f: WatchItem) {
  const g = store.groups.find((x) => x.id === f.group_id);
  const it = g?.items?.find((x) => x.id === f.id);
  if (!it) return ElMessage.warning('这张卡片已不在当前列表里，刷新后再看');
  iEdit.value = { gid: f.group_id, it };
}

/* 单条结果文字：正常只显示状态码，异常把原因放悬浮提示里 */
function linkText(s?: LinkState): string {
  if (!s) return '';
  if (s.error) return '异常';
  return String(s.status);
}

/* 常见状态码的人话解释：悬浮色标时告诉用户「这个数字到底意味着什么」。
   4xx/5xx 里专门标注了哪些是「站点挡机器人、链接本身没事」，避免误删正常卡片 */
const STATUS_HINT: Record<number, string> = {
  301: '永久重定向：站点跳到了新地址，建议把卡片改成最终地址',
  302: '临时重定向：站点跳转到了别的地址（链接本身可用）',
  303: '重定向：站点要求用 GET 重新请求（链接本身可用）',
  307: '临时重定向：站点暂时跳转到别的地址',
  308: '永久重定向：站点永久跳转到新地址，建议更新卡片',
  400: '请求无效：站点认为地址或参数格式有问题',
  401: '需要登录：站点要求身份验证，未登录访客打开可能看不到内容',
  403: '访问被拒绝：站点开了反爬 / 防火墙，挡住了自动检查；用浏览器打开大概率正常',
  404: '页面不存在：地址可能已失效，建议核对或更新',
  405: '请求方式不被允许：站点不支持探测请求（已自动重试过 GET）',
  408: '请求超时：站点响应太慢被掐断',
  410: '已永久下线：资源被站点移除，建议删除或更换卡片',
  412: '前置条件失败：常见于防火墙 / CDN（如 Cloudflare）拦截探测请求，浏览器打开大概率正常',
  418: '站点拒绝机器人访问（彩蛋状态码，链接本身正常）',
  429: '请求过于频繁：站点限流了自动检查；用浏览器打开大概率正常',
  451: '地区限制：站点在当前区域不可访问',
  500: '服务器内部错误：站点自身故障',
  502: '网关错误：站点后端无响应',
  503: '服务不可用：站点过载或正在维护',
  504: '网关超时：站点后端响应超时',
  530: 'Cloudflare 无法回源：源站宕机或配置异常',
};
function statusHint(s: LinkState): string {
  if (s.error) return s.error;
  const hit = STATUS_HINT[s.status];
  if (hit) return hit;
  if (s.status >= 500) return '服务器错误：站点自身出了故障';
  if (s.status >= 400) return '请求被站点拒绝：具体原因站点未说明';
  return '正常响应：链接可达';
}

/* 悬浮提示标题行：状态码 + 分级结论 */
const LEVEL_LABEL: Record<LinkState['level'], string> = { ok: '正常', warn: '受限（链接可用，站点挡了自动检查）', bad: '异常' };
function linkTipHead(s: LinkState): string {
  if (s.error) return '连接失败';
  return `HTTP ${s.status} · ${LEVEL_LABEL[s.level]}`;
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>分组与卡片</h2>
        <div class="sub">点分组展开查看，拖动分组或卡片调整顺序</div>
      </div>
      <div class="head-ops">
        <el-button :loading="watchRunning" :title="'自动巡检上次运行：' + tsText(watchLast.at)" @click="runWatchNow">
          <IIcon name="ri:shield-check-line" :size="14" class="btn-ico" />检查全部链接
        </el-button>
        <el-button type="primary" @click="gEdit = 'new'">＋ 添加分组</el-button>
      </div>
    </div>

    <el-empty v-if="!store.groups.length" description="还没有分组，点右上角「添加分组」开始" />

    <!-- 自动巡检发现的失效链接：只在真有问题时出现，平时不占屏 -->
    <div v-if="watchFailed.length" class="watch-bar">
      <IIcon name="ri:error-warning-line" :size="15" class="watch-ico" />
      <div class="watch-text">
        <b>{{ watchFailed.length }}</b> 条链接疑似失效
        <span class="watch-sub">连续失败 3 次以上 · 上次巡检 {{ tsText(watchLast.at) }}</span>
      </div>
      <button class="watch-link" @click="watchOpen = !watchOpen">{{ watchOpen ? '收起' : '查看明细' }}</button>
      <button class="watch-link" :disabled="watchRunning" @click="runWatchNow">
        {{ watchRunning ? '巡检中…' : '立即巡检' }}
      </button>
    </div>
    <div v-if="watchOpen && watchFailed.length" class="watch-list">
      <div v-for="f in watchFailed" :key="f.id" class="watch-row" @click="openFailed(f)"
           title="点击打开这张卡片的编辑弹窗">
        <span class="watch-name">{{ f.title || '未命名卡片' }}</span>
        <span class="watch-url">{{ f.url }}</span>
        <span class="watch-code">{{ f.status || f.error || '无响应' }}</span>
        <span class="watch-streak">连续 {{ f.fail_streak }} 次</span>
      </div>
    </div>

    <div v-for="g in store.groups" :key="g.id" class="sp-card group"
         :class="[{ closed: isClosed(g.id) }, dragClass('group')]"
         draggable="true"
         @dragstart="onDragStart('group', g.id)" @dragover.prevent @drop="onDrop('group', g.id)">
      <div class="g-head" @click="toggleGroup(g.id)" title="点击展开 / 收起">
        <span class="g-grip"><el-icon><Rank /></el-icon></span>
        <!-- 分组图标：设了就用设置的那个，没设退回文件夹（IIcon 内联 SVG，跟着文字色走） -->
        <IIcon :name="g.icon_name || 'solar:folder-bold-duotone'" :size="18" class="g-icon" />
        <div class="g-title">
          {{ g.title }}
          <span class="g-count">{{ g.icon_count || 0 }} 张卡片</span>
          <span v-if="g.public_show" class="g-badge" title="未登录的访客也能看到这个分组">免登录可见</span>
        </div>
        <div class="g-ops" @click.stop>
          <!-- 链接检查：只查本组、只查外网。未查过是低调幽灵按钮（悬浮本组才浮现），
               查完变成色标胶囊（绿 / 橙 / 红），再点一次就是重新检查；本组没有外网地址就不显示 -->
          <button
            v-if="groupStat(g).total"
            class="g-lc"
            :class="groupLevel(g) ? 'lv-' + groupLevel(g) : 'unchecked'"
            :disabled="isRunning(g)"
            :title="groupCheckTitle(g)"
            @click="checkGroup(g)"
          >
            <el-icon v-if="isRunning(g)" class="is-loading"><Loading /></el-icon>
            <IIcon v-else-if="groupLevel(g)" name="ri:link" :size="12" />
            <IIcon v-else name="ri:link-m" :size="12" />
            <span>{{ groupCheckText(g) }}</span>
          </button>
          <el-button link size="small" :icon="Edit" title="编辑分组" @click="gEdit = g" />
          <el-button link size="small" type="danger" :icon="Delete" title="删除分组" @click="delGroup(g.id)" />
        </div>
        <!-- 折叠箭头钉在最右（操作按钮之后）：标题被压窄时也不会把它顶到左边去 -->
        <span class="g-chev"><el-icon><ArrowRight /></el-icon></span>
      </div>

      <div class="g-body">
        <div class="g-clip">
          <div class="g-items">
            <div class="item-row" v-for="it in g.items" :key="it.id"
                 :class="dragClass('icon')" draggable="true"
                 @dragstart="onDragStart('icon', it.id, g.id, $event)" @dragover.prevent @drop.stop="onDrop('icon', it.id, g.id)">
              <span class="item-grip"><el-icon><Rank /></el-icon></span>
              <!-- 未设背景色统一走玻璃底板（两种卡片形态都是），不再铺 #2b3036 深色块：
                   和前台 .card .ic.plain / .mini .mic.plain 保持同一套规则 -->
              <div class="item-ico"
                   :class="{ glass: !it.background_color, mini: g.card_style === 'icon' }"
                   :style="it.background_color ? { background: it.background_color } : {}">
                <!-- 取图顺序与前台 / 弹窗预览一致：按 icon_type 决定，而不是 icon_url 有值就用 ——
                     历史卡片改过在线图标后 icon_url 里还残留着旧 favicon，
                     按 icon_url 优先渲染就会出现「列表和预览、导航对不上」的错觉 -->
                <img v-if="(it.icon_type === 'data' || it.icon_type === 'r2') && it.icon_url" :src="it.icon_url" />
                <img v-else-if="it.icon_type === 'iconify' && it.icon_name" :src="iconSrc(it.icon_name, it.background_color)" />
                <span v-else :style="{ fontSize: listPlateFs(it), whiteSpace: 'nowrap' }">{{ listPlateText(it) }}</span>
              </div>
              <div class="item-info">
                <div class="item-name-row">
                  <span class="item-name">{{ it.title }}</span>
                  <span v-if="it.description" class="item-desc">{{ it.description }}</span>
                </div>
                <!-- 网址行：外网 / 内网 各配一枚小标签，和网址之间留白分开；
                     没配的那条直接不显示，两条都在时用间距分段 -->
                <div class="item-url">
                  <span v-if="it.url" class="url-item">
                    <em class="url-tag">外网</em>
                    <span class="url-text" :title="it.url">{{ it.url }}</span>
                  </span>
                  <span v-if="it.lan_url" class="url-item">
                    <em class="url-tag lan">内网</em>
                    <span class="url-text" :title="it.lan_url">{{ it.lan_url }}</span>
                  </span>
                  <span v-if="!it.url && !it.lan_url" class="url-none">未填写网址</span>
                </div>
              </div>
              <!-- 右侧补状态：打开方式 + 链接检查结果（只有查过才显示）。
                   检查结果悬浮出提示：状态码含义 + 耗时，不再只给一个看不懂的数字 -->
              <div class="item-tags">
                <el-tooltip v-if="linkMap[it.id]" placement="top" :show-after="120">
                  <template #content>
                    <div class="lc-tip">
                      <div class="lc-tip-head" :class="'is-' + linkMap[it.id].level">{{ linkTipHead(linkMap[it.id]) }}</div>
                      <div class="lc-tip-reason">{{ statusHint(linkMap[it.id]) }}</div>
                      <div class="lc-tip-foot">耗时 {{ linkMap[it.id].ms }}ms · 再点一次「链接检查」可重新检测</div>
                    </div>
                  </template>
                  <span class="lc" :class="'lc-' + linkMap[it.id].level">{{ linkText(linkMap[it.id]) }}</span>
                </el-tooltip>
                <span class="tag">{{ OPEN_LABEL[it.open_method] || '新标签打开' }}</span>
              </div>
              <div class="item-ops">
                <el-button link size="small" :icon="Edit" title="编辑卡片" @click="iEdit = { gid: g.id, it }" />
                <el-button link size="small" type="danger" :icon="Delete" title="删除卡片" @click="delIcon(it.id)" />
              </div>
            </div>
            <el-button size="small" class="add-item" @click="iEdit = { gid: g.id, it: null }">＋ 添加卡片</el-button>
          </div>
        </div>
      </div>
    </div>

    <GroupEditModal v-if="gEdit" :model-value="gEdit" @close="gEdit = null" @save="saveGroup" />
    <IconEditModal v-if="iEdit" :model-value="iEdit" :groups="store.groups" @close="closeEdit" @save="saveIcon" />
  </div>
</template>

<style scoped>
  .group { padding: 0; overflow: hidden; }

  /* ---- 自动巡检：失效提示条 + 明细列表 ---- */
  .watch-bar {
    display: flex; align-items: center; gap: 9px;
    padding: 9px 14px; margin-bottom: 12px;
    border-radius: 10px;
    background: rgba(245, 108, 108, .08);
    border: 1px solid rgba(245, 108, 108, .28);
    color: var(--sp-danger-text);
    font-size: 13px;
  }
  .watch-ico { flex: none; }
  .watch-text { flex: 1; min-width: 0; }
  .watch-text b { font-weight: 600; }
  .watch-sub { display: block; margin-top: 1px; font-size: 11.5px; color: var(--sp-dim); }
  .watch-link {
    flex: none; background: transparent; border: 0; padding: 0 2px;
    color: var(--sp-danger-text); font-size: 12.5px; cursor: pointer;
    text-decoration: underline; text-underline-offset: 3px;
  }
  .watch-link:disabled { opacity: .55; cursor: default; }

  .watch-list {
    margin: -4px 0 12px; border: 1px solid var(--sp-card-border);
    border-radius: 10px; overflow: hidden; background: var(--sp-card-in);
  }
  .watch-row {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; font-size: 12.5px; cursor: pointer;
    border-bottom: 1px solid var(--sp-card-border);
  }
  .watch-row:last-child { border-bottom: 0; }
  .watch-row:hover { background: var(--sp-hover); }
  .watch-name { flex: none; max-width: 150px; font-weight: 500;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .watch-url { flex: 1; min-width: 0; color: var(--sp-dim);
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .watch-code { flex: none; color: var(--sp-danger-text); font-variant-numeric: tabular-nums; }
  .watch-streak { flex: none; color: var(--sp-faint); font-size: 11.5px; }

  /* 展开 / 收起：grid 轨道从 1fr 收到 0fr，比 max-height 动画顺 */
  .g-body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows .26s ease; }
  .group.closed .g-body { grid-template-rows: 0fr; }
  .g-clip { min-height: 0; overflow: hidden; }
  .g-items { padding: 14px 16px 16px; }

  .g-head {
    display: flex; align-items: center; gap: 11px;
    padding: 12px 16px;
    background: var(--sp-card-in);
    cursor: pointer; user-select: none;
    transition: background .15s;
  }
  .group:not(.closed) .g-head { border-bottom: 1px solid var(--sp-card-border); }
  .group:hover .g-head { background: var(--sp-hover); }

  .g-grip { color: var(--sp-faint); cursor: grab; display: flex; flex: none; }
  .g-grip:active { cursor: grabbing; }
  /* 分组图标：双色文件夹 + 暖黄，比实心黑块轻；duotone 的第二层用透明度叠色，跟随 currentColor */
  .g-icon { flex: none; color: var(--el-color-warning, #e6a23c); }
  .g-title { font-weight: 600; font-size: 14.5px; flex: 1; min-width: 0;
             display: flex; align-items: center; gap: 9px;
             white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .g-count {
    font-size: 11.5px; font-weight: 400; color: var(--sp-dim);
    background: var(--sp-chip-bg); padding: 1px 8px; border-radius: 20px;
    flex: none;
  }
  /* 免登录可见的标识，和普通「张卡片」徽标区分开 */
  .g-badge {
    font-size: 11px; font-weight: 500; color: var(--sp-accent);
    background: rgba(var(--sp-accent-rgb), .12); border: 1px solid rgba(var(--sp-accent-rgb), .28);
    padding: 1px 8px; border-radius: 20px; flex: none;
  }
  .g-chev { color: var(--sp-dim); flex: none; display: flex; transition: transform .24s ease; }
  .group:not(.closed) .g-chev { transform: rotate(90deg); }
  .g-ops { display: flex; gap: 2px; flex: none; }
  .g-ops .el-icon, .item-ops .el-icon { font-size: 15px; }
  .g-ops .el-button, .item-ops .el-button { padding: 5px; height: auto; }

  .item-row {
    display: flex; align-items: center; gap: 11px;
    background: var(--sp-card-in); border: 1px solid transparent;
    border-radius: 10px; padding: 8px 11px; margin-bottom: 8px;
    cursor: grab; transition: background .15s, border-color .15s;
  }
  .item-row:active { cursor: grabbing; }
  .item-row:hover { background: var(--sp-hover); border-color: var(--sp-card-border); }
  .item-grip { color: var(--sp-faint); flex: none; display: flex; }
  /* 46px 与前台信息卡图标（.card .ic）同尺寸，尺寸也跟导航对得上，不只是「大概像」 */
  .item-ico {
    flex: 0 0 46px; width: 46px; height: 46px; border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 16px; overflow: hidden;
  }
  .item-ico img { width: 100%; height: 100%; object-fit: cover; }
  /* 未设背景色时严格镜像前台两种形态：
     - 信息卡分组：前台 .card .ic.plain 是「透明底」（图标直接浮在卡片上），列表同样透明。
       之前这里铺 --sp-card-in，与行背景同色，只剩一圈描边，图标像闷在灰块里。
     - 小图标分组：前台 .mic.plain 有白色底板 + 细边 + 轻阴影，见下面 .mini 规则。 */
  .item-ico.glass { background: transparent; border: 0; color: var(--sp-text); }
  .item-ico.glass.mini {
    background: #fff; border: 1px solid rgba(31, 35, 40, .08);
    box-shadow: 0 2px 8px rgba(31, 35, 40, .12);
  }
  html.dark .item-ico.glass.mini {
    background: #343a41; border-color: rgba(255, 255, 255, .08);
    box-shadow: 0 2px 8px rgba(0, 0, 0, .30);
  }
  /* 小图标分组：图片撑满底板（100% + contain 保持比例），信息卡分组同样是铺满。
     注意 contain 不限 .glass —— 设了背景色的 mini 卡片也要撑满。 */
  .item-ico.mini img { width: 100%; height: 100%; object-fit: contain; border-radius: 9px; }
  .item-info { flex: 1; min-width: 0; }
  /* 标题 + 描述同一行：标题固定宽度上限，描述吃掉剩余空间并省略 */
  .item-name-row { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .item-name-row .item-name { flex: none; max-width: 42%; }
  .item-desc {
    font-size: 12px; color: var(--sp-dim); font-weight: 400;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
  }
  /* 右侧状态标签：低饱和胶囊，不抢标题视线 */
  .item-tags { display: flex; align-items: center; gap: 6px; flex: none; }
  /* 链接检查结果：正常灰绿、受限橙、异常红 —— 只有查过才出现在行尾 */
  .lc {
    font-size: 11px; line-height: 1; padding: 4px 7px; border-radius: 6px;
    font-variant-numeric: tabular-nums; white-space: nowrap;
    border: 1px solid transparent;
  }
  .lc-ok { color: var(--sp-ok); background: rgba(var(--sp-ok-rgb), .10); border-color: rgba(var(--sp-ok-rgb), .28); }
  .lc-warn { color: #c98a2e; background: rgba(230, 162, 60, .12); border-color: rgba(230, 162, 60, .32); }
  .lc-bad { color: #d1544b; background: rgba(239, 68, 68, .10); border-color: rgba(239, 68, 68, .30); }

  /* 链接检查悬浮提示（el-tooltip 内容，编译在本组件所以 scoped 能命中） */
  .lc-tip { max-width: 340px; line-height: 1.55; }
  .lc-tip-head { font-weight: 600; margin-bottom: 2px; }
  .lc-tip-head.is-ok { color: #95d475; }
  .lc-tip-head.is-warn { color: #eebe77; }
  .lc-tip-head.is-bad { color: #f89898; }
  .lc-tip-reason { margin-bottom: 2px; }
  .lc-tip-foot { opacity: .65; font-size: 11px; }

  /* 头部右侧：只剩「添加分组」 */
  .head-ops { display: flex; align-items: center; gap: 10px; }

  /* 组内的链接检查按钮：24px 小胶囊，落在分组标题行右侧（编辑 / 删除前面）。
     未查过时完全隐形，悬浮这一组才淡入 —— 和前台分组标题的「＋」同一套逻辑，
     免得每个分组都挂一颗「检查链接」把标题行挤满。
     查完则常显，颜色即状态：绿=全通、橙=有受限、红=有异常。 */
  .g-lc {
    flex: none; display: inline-flex; align-items: center; gap: 5px;
    height: 24px; padding: 0 8px; margin-right: 4px;
    border-radius: 7px; cursor: pointer;
    font-family: inherit; font-size: 11.5px; font-weight: 500; line-height: 1;
    color: var(--sp-dim); background: transparent;
    border: 1px solid var(--sp-card-border);
    font-variant-numeric: tabular-nums; white-space: nowrap;
    transition: opacity .16s, color .16s, background .16s, border-color .16s;
  }
  .g-lc span { display: block; }
  .g-lc:hover { color: var(--sp-text); background: var(--sp-chip-bg); border-color: var(--sp-border); }
  .g-lc:disabled { cursor: default; }
  .g-lc:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 1px; }
  /* 未查过：隐形，悬浮本组才浮现；键盘 Tab 到它时也要看得见 */
  .g-lc.unchecked { opacity: 0; }
  .group:hover .g-lc.unchecked,
  .g-lc.unchecked:focus-visible { opacity: .85; }
  .group:hover .g-lc.unchecked:hover { opacity: 1; }
  /* 已出结果：常显 + 上色 */
  .g-lc.lv-ok { color: var(--sp-ok); background: rgba(var(--sp-ok-rgb), .10); border-color: rgba(var(--sp-ok-rgb), .28); }
  .g-lc.lv-warn { color: #c98a2e; background: rgba(230, 162, 60, .12); border-color: rgba(230, 162, 60, .32); }
  .g-lc.lv-bad { color: #d1544b; background: rgba(239, 68, 68, .10); border-color: rgba(239, 68, 68, .30); }
  .g-lc.lv-ok:hover { background: rgba(var(--sp-ok-rgb), .16); }
  .g-lc.lv-warn:hover { background: rgba(230, 162, 60, .18); }
  .g-lc.lv-bad:hover { background: rgba(239, 68, 68, .16); }
  .item-tags .tag {
    font-size: 11px; line-height: 1; padding: 4px 7px; border-radius: 6px;
    color: var(--sp-dim); background: var(--sp-chip-bg);
    border: 1px solid var(--sp-card-border);
    white-space: nowrap;
  }
  .item-name { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* 网址行：标签 + 等宽字体网址。原来把「外网 / 内网」做成加粗灰字直接怼在 URL 前面，
     两条线路挤成一行像没排版；改成小色标后一眼能分出是哪条线，URL 也不会被当成正文。
     两条各占半行（flex:1 1 0）而不是按内容分宽：外网地址一长就会把「内网」标签推到右边、
     长到撑满还会被 overflow 裁掉。等分后两个标签的横向位置恒定，地址超长只在自己的半格里省略 */
  .item-url {
    margin-top: 3px; display: flex; align-items: center; flex-wrap: nowrap;
    gap: 5px 14px; min-width: 0; overflow: hidden;
  }
  .item-url .url-item { display: inline-flex; align-items: center; gap: 6px; flex: 1 1 0; min-width: 0; }
  .item-url .url-tag {
    flex: none; font-style: normal; font-size: 10px; font-weight: 600; line-height: 1;
    letter-spacing: .04em; padding: 3px 5px; border-radius: 5px;
    color: var(--sp-tag-wan-fg); background: var(--sp-tag-wan-bg);
    border: 1px solid var(--sp-tag-wan-bd);
  }
  .item-url .url-tag.lan {
    color: var(--sp-tag-lan-fg); background: var(--sp-tag-lan-bg);
    border-color: var(--sp-tag-lan-bd);
  }
  .item-url .url-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; color: var(--sp-dim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
  }
  .item-url .url-none { font-size: 12px; color: var(--sp-faint); opacity: .75; }
  .item-ops { display: flex; gap: 2px; flex: none; }
  .add-item { width: 100%; border-style: dashed; }

  .drag-target { outline: 1.5px dashed var(--sp-accent); outline-offset: -1.5px; }
</style>
