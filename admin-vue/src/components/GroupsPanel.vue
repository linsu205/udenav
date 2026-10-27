<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useStore, type Group, type IconItem } from '../store';
import { post, patch, del } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Edit, Delete, Rank, ArrowRight } from '@element-plus/icons-vue';
import { notifyHome } from '../lib/notify';
import GroupEditModal from './GroupEditModal.vue';
import IconEditModal from './IconEditModal.vue';

const store = useStore();
const gEdit = ref<Group | null | 'new'>(null);
const iEdit = ref<{ gid: number; it: IconItem | null } | null>(null);
const dragSrc = ref<{ kind: 'group' | 'icon'; id: number; gid?: number } | null>(null);

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
  if (iEdit.value!.it) await patch('/api/admin/icons/' + iEdit.value!.it.id, it);
  else await post('/api/admin/icons', { ...it, group_id: iEdit.value!.gid });
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
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>分组与卡片</h2>
        <div class="sub">点分组展开查看，拖动分组或卡片调整顺序</div>
      </div>
      <el-button type="success" @click="gEdit = 'new'">＋ 添加分组</el-button>
    </div>

    <el-empty v-if="!store.groups.length" description="还没有分组，点右上角「添加分组」开始" />

    <div v-for="g in store.groups" :key="g.id" class="sp-card group"
         :class="[{ closed: isClosed(g.id) }, dragClass('group')]"
         draggable="true"
         @dragstart="onDragStart('group', g.id)" @dragover.prevent @drop="onDrop('group', g.id)">
      <div class="g-head" @click="toggleGroup(g.id)" title="点击展开 / 收起">
        <span class="g-grip"><el-icon><Rank /></el-icon></span>
        <span class="g-icon">📁</span>
        <div class="g-title">
          {{ g.title }}
          <span class="g-count">{{ g.icon_count || 0 }} 张卡片</span>
          <span v-if="g.public_show" class="g-badge" title="未登录的访客也能看到这个分组">免登录可见</span>
        </div>
        <span class="g-chev"><el-icon><ArrowRight /></el-icon></span>
        <div class="g-ops" @click.stop>
          <el-button link size="small" :icon="Edit" title="编辑分组" @click="gEdit = g" />
          <el-button link size="small" type="danger" :icon="Delete" title="删除分组" @click="delGroup(g.id)" />
        </div>
      </div>

      <div class="g-body">
        <div class="g-clip">
          <div class="g-items">
            <div class="item-row" v-for="it in g.items" :key="it.id"
                 :class="dragClass('icon')" draggable="true"
                 @dragstart="onDragStart('icon', it.id, g.id, $event)" @dragover.prevent @drop.stop="onDrop('icon', it.id, g.id)">
              <span class="item-grip"><el-icon><Rank /></el-icon></span>
              <div class="item-ico" :style="{ background: it.background_color || '#2b3036' }">
                <img v-if="it.icon_url" :src="it.icon_url" />
                <span v-else>{{ (it.title || '?').charAt(0).toUpperCase() }}</span>
              </div>
              <div class="item-info">
                <div class="item-name">{{ it.title }}</div>
                <div class="item-url">{{ it.url || '（无网址）' }}</div>
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
  .g-icon { font-size: 17px; flex: none; }
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
    background: rgba(47, 191, 107, .12); border: 1px solid rgba(47, 191, 107, .28);
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
  .item-ico {
    flex: 0 0 38px; width: 38px; height: 38px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 16px; overflow: hidden;
  }
  .item-ico img { width: 100%; height: 100%; object-fit: cover; }
  .item-info { flex: 1; min-width: 0; }
  .item-name { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-url { font-size: 12px; color: var(--sp-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-ops { display: flex; gap: 2px; flex: none; }
  .add-item { width: 100%; border-style: dashed; }

  .drag-target { outline: 1.5px dashed var(--sp-accent); outline-offset: -1.5px; }
</style>
