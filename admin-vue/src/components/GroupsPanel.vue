<script setup lang="ts">
import { ref, onMounted, reactive } from 'vue';
import { useStore, type Group, type IconItem } from '../store';
import { post, patch, del } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Edit, Delete, Rank, ArrowRight, Loading } from '@element-plus/icons-vue';
import { notifyHome } from '../lib/notify';
import { iconSrc } from '../lib/icon-color';
import { probeInBrowser, type ProbeLevel } from '../lib/probe';
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

/* 列表里的网址做成可点链接。地址可能没写协议（老数据 / 手填忘了），
   直接丢给 href 会被当成站内相对路径，点开变成 404 —— 补一下协议。
   已有协议的一律原样返回，别自作聪明改写用户的地址 */
function urlHref(u: string): string {
  const s = String(u || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return 'http://' + s;
}

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

onMounted(() => { if (!store.groups.length) store.loadAll(); });

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
   点分组标题右侧的按钮，只查这一组的外网地址，边查边出结果，结果只留在当前页面。
   探测在浏览器本机做（见 lib/probe.ts）：浏览器就在用户自己的网络里，访问国内站点
   和真实点击走的是同一条路，不会像 Worker 那样被 WAF 当成境外 IP / 机器人拦掉。
   代价是跨域读不到状态码，所以只分三档：
     ok          能连上就是能打开（站点回 404/403 也算，浏览器确实连上了）
                 http 地址在 https 页面里探不了，但域名解析正常时同样算 ok（点击能跳转）
     unreachable 本机连不上：可能站点停了，也可能被网络环境或拦截插件挡了
     skipped     http 地址探不了、域名也查不到 —— 不下结论，界面不显示标记、不算异常
   只查外网地址（it.url），内网地址需要你在浏览器里点开确认。 */
interface LinkState {
  level: ProbeLevel;
  ms: number;
  why: string;
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
  let ok = 0, no = 0, skip = 0, n = 0;
  for (const it of list) {
    const s = linkMap[it.id];
    if (!s) continue;
    n++;
    if (s.level === 'ok') ok++;
    else if (s.level === 'skipped') skip++;
    else no++;
  }
  return { total: list.length, n, ok, no, skip };
}

/* 只有「全部确认可达」才绿；有连不上标橙，不染红 ——
   拦截插件、公司网络、VPN 都会造成本机连不上，标红只会天天误报。
   全是「探不了」的（整组都是 http 地址）用中性灰，别装成检查过也没问题 */
function groupLevel(g: Group): '' | 'ok' | 'warn' | 'skip' {
  const s = groupStat(g);
  if (!s.n) return '';
  if (s.no) return 'warn';
  return s.ok ? 'ok' : 'skip';
}

const isRunning = (g: Group) => !!runMap[g.id];

function groupCheckText(g: Group): string {
  const run = runMap[g.id];
  if (run) return `检查中 ${run.done}/${run.total}`;
  const s = groupStat(g);
  if (!checkedSet[g.id] || !s.total) return '检查链接';
  /* 「待确认」只算真的连不上的；探不了的 http 地址不算异常，不能让它天天挂着提示 */
  if (s.no) return `待确认 ${s.no}`;
  if (!s.ok) return '已检查';
  return '全部正常';
}

function groupCheckTitle(g: Group): string {
  const run = runMap[g.id];
  if (run) return `正在本机检查本组外网链接 ${run.done}/${run.total}`;
  const s = groupStat(g);
  if (!checkedSet[g.id] || !s.total) {
    return s.total ? `在本机检查本组 ${s.total} 个外网链接（不查内网）` : '本组没有外网地址可查';
  }
  const head = `共 ${s.total} 条：可访问 ${s.ok}，连不上 ${s.no}`
    + (s.skip ? `，无法探测 ${s.skip}` : '');
  const skipNote = s.skip
    ? '\n「无法探测」= http 地址在 https 页面里不让探（浏览器混合内容限制），点击跳转不受影响'
    : '';
  return `${head}\n「连不上」也可能是拦截插件或当前网络挡的，点开确认一下再决定${skipNote}\n点击重新检查（只查外网）`;
}

async function checkGroup(g: Group) {
  if (runMap[g.id]) return;                      // 防重入：连点不会发两轮
  const list = checkableItems(g);
  if (!list.length) return ElMessage.warning('这一组没有外网地址可查');

  for (const it of list) delete linkMap[it.id];  // 先清本组旧结果，避免新旧混着看
  runMap[g.id] = { done: 0, total: list.length };

  /* 6 路并发：浏览器对同一站点本来也只给 6 个连接，再高只是排队；
     不同站点之间这样已经够快，几十条的组通常几秒出完 */
  const queue = list.slice();
  let done = 0;
  const worker = async () => {
    for (;;) {
      const it = queue.shift();
      if (!it) return;
      const r = await probeInBrowser(it.url || '');
      linkMap[it.id] = { level: r.level, ms: r.ms, why: r.why };
      done++;
      runMap[g.id] = { done, total: list.length };
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
    checkedSet[g.id] = true;
    const s = groupStat(g);
    /* 只有真的连不上才需要提醒；探不了的 http 地址不弹黄条，免得每组都报一次 */
    if (s.no) {
      ElMessage.warning(`「${g.title}」${s.no} 条连不上（共 ${s.total} 条），点开确认一下`);
    } else if (!s.ok) {
      ElMessage.info(`「${g.title}」${s.skip} 条是 http 地址，本页探不了，点击跳转不受影响`);
    } else {
      ElMessage.success(`「${g.title}」${s.total} 条外网链接全部可访问`);
    }
  } finally {
    delete runMap[g.id];
  }
}

/* 单条结果文字：胶囊很窄，用最短的词。探不了的（skipped）在模板里整块不渲染，
   所以这里只有两种；具体依据看悬浮提示 */
function linkText(s?: LinkState): string {
  if (!s) return '';
  return s.level === 'ok' ? '通' : '待确认';
}

/* 悬浮提示标题：结论 + 本机耗时 */
const LEVEL_LABEL: Record<ProbeLevel, string> = {
  ok: '可访问',
  unreachable: '本机连不上',
  skipped: '无法探测',
};
function linkTipHead(s: LinkState): string {
  return `${LEVEL_LABEL[s.level]}${s.ms ? ` · ${s.ms} ms` : ''}`;
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
        <el-button type="primary" @click="gEdit = 'new'">＋ 添加分组</el-button>
      </div>
    </div>

    <el-empty v-if="!store.groups.length" description="还没有分组，点右上角「添加分组」开始" />

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
               查完变成色标胶囊（绿 / 橙），再点一次就是重新检查；本组没有外网地址就不显示 -->
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
                     没配的那条直接不显示，两条都在时用间距分段。
                     地址本身是链接，可直接新标签打开（内网地址同样） -->
                <div class="item-url">
                  <!-- 网址本身做成链接：列表里看到就直接新标签打开，不用先进编辑弹窗。
                       内网地址同理 —— 后台页面是 https，导航到 http 只会拦「探测」，
                       点击跳转浏览器照样放行，所以两种地址一视同仁 -->
                  <span v-if="it.url" class="url-item">
                    <em class="url-tag">外网</em>
                    <a class="url-text" :href="urlHref(it.url)" :title="it.url + '（点击新标签打开）'"
                       target="_blank" rel="noopener noreferrer" draggable="false" @click.stop>{{ it.url }}</a>
                  </span>
                  <span v-if="it.lan_url" class="url-item">
                    <em class="url-tag lan">内网</em>
                    <a class="url-text" :href="urlHref(it.lan_url)" :title="it.lan_url + '（点击新标签打开）'"
                       target="_blank" rel="noopener noreferrer" draggable="false" @click.stop>{{ it.lan_url }}</a>
                  </span>
                  <span v-if="!it.url && !it.lan_url" class="url-none">未填写网址</span>
                </div>
              </div>
              <!-- 右侧补状态：打开方式 + 链接检查结果（只有查过才显示）。
                   检查结果悬浮出提示：本机探测的结论与原因，不再假装有状态码 -->
              <div class="item-tags">
                <el-tooltip v-if="linkMap[it.id] && linkMap[it.id].level !== 'skipped'" placement="top" :show-after="120">
                  <template #content>
                    <div class="lc-tip">
                      <div class="lc-tip-head" :class="'is-' + linkMap[it.id].level">{{ linkTipHead(linkMap[it.id]) }}</div>
                      <div class="lc-tip-reason">{{ linkMap[it.id].why }}</div>
                      <div class="lc-tip-foot">再点一次分组标题上的「检查链接」可重新检测</div>
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
  /* 连不上：橙色「待确认」。本机探测失败可能是拦截插件/网络挡的，不能等同死链。
     探不了的 http 地址根本不渲染胶囊，所以这里没有灰色态 */
  .lc-unreachable { color: #c98a2e; background: rgba(230, 162, 60, .12); border-color: rgba(230, 162, 60, .32); }

  /* 链接检查悬浮提示（el-tooltip 内容，编译在本组件所以 scoped 能命中） */
  .lc-tip { max-width: 340px; line-height: 1.55; }
  .lc-tip-head { font-weight: 600; margin-bottom: 2px; }
  .lc-tip-head.is-ok { color: #95d475; }
  .lc-tip-head.is-unreachable { color: #eebe77; }
  .lc-tip-head.is-skipped { color: #b1b3b8; }
  .lc-tip-reason { margin-bottom: 2px; }
  .lc-tip-foot { opacity: .65; font-size: 11px; }

  /* 头部右侧：只剩「添加分组」 */
  .head-ops { display: flex; align-items: center; gap: 10px; }

  /* 组内的链接检查按钮：24px 小胶囊，落在分组标题行右侧（编辑 / 删除前面）。
     未查过时完全隐形，悬浮这一组才淡入 —— 和前台分组标题的「＋」同一套逻辑，
     免得每个分组都挂一颗「检查链接」把标题行挤满。
     查完则常显，颜色即状态：绿=全部可访问、橙=有待确认、灰=探不了（不会标红）。 */
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
  /* 整组都是探不了的 http 地址：中性灰，只说明「查过了」，不给「正常」的错觉 */
  .g-lc.lv-skip { color: var(--sp-dim); background: transparent; border-color: var(--sp-card-border); }
  .g-lc.lv-ok:hover { background: rgba(var(--sp-ok-rgb), .16); }
  .g-lc.lv-warn:hover { background: rgba(230, 162, 60, .18); }
  .g-lc.lv-skip:hover { background: var(--sp-chip-bg); }
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
  /* 网址文本本身就是链接：默认低调（和正文同色），悬浮才亮起来 + 下划线。
     不给常显下划线 —— 一屏几十条地址全是蓝线，列表会花得没法看 */
  .item-url .url-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; color: var(--sp-dim);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
    text-decoration: none; cursor: pointer; border-radius: 3px;
    transition: color .12s, text-decoration-color .12s;
  }
  .item-url .url-text:hover {
    color: var(--sp-accent);
    text-decoration: underline; text-underline-offset: 2px;
    text-decoration-thickness: 1px;
  }
  .item-url .url-text:focus-visible { outline: 1.5px solid var(--sp-accent); outline-offset: 1px; }
  .item-url .url-none { font-size: 12px; color: var(--sp-faint); opacity: .75; }
  .item-ops { display: flex; gap: 2px; flex: none; }
  .add-item { width: 100%; border-style: dashed; }

  .drag-target { outline: 1.5px dashed var(--sp-accent); outline-offset: -1.5px; }
</style>
