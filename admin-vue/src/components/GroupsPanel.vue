<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useStore, type Group, type IconItem } from '../store';
import { post, patch, del } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import { notifyHome } from '../lib/notify';
import GroupEditModal from './GroupEditModal.vue';
import IconEditModal from './IconEditModal.vue';

const store = useStore();
const gEdit = ref<Group | null | 'new'>(null);
const iEdit = ref<{ gid: number; it: IconItem | null } | null>(null);
const dragSrc = ref<{ kind: 'group' | 'icon'; id: number; gid?: number } | null>(null);

onMounted(() => { if (!store.groups.length) store.loadAll(); });

async function saveGroup(g: Partial<Group> & { title: string }) {
  if (gEdit.value === 'new') await post('/api/admin/groups', g);
  else await patch('/api/admin/groups/' + gEdit.value!.id, g);
  gEdit.value = null;
  await store.loadAll();
  notifyHome();
  ElMessage.success('已保存，前台已同步');
}

async function saveIcon(it: Partial<IconItem> & { title: string; url: string }) {
  if (iEdit.value!.it) await patch('/api/admin/icons/' + iEdit.value!.it.id, it);
  else await post('/api/admin/icons', { ...it, group_id: iEdit.value!.gid });
  iEdit.value = null;
  await store.loadAll();
  notifyHome();
  ElMessage.success('已保存，前台已同步');
}

async function delGroup(id: number) {
  await ElMessageBox.confirm('删除该分组及其全部卡片？', '确认删除', { type: 'warning' });
  await del('/api/admin/groups/' + id);
  await store.loadAll();
  notifyHome();
  ElMessage.success('已删除，前台已同步');
}

async function delIcon(id: number) {
  await ElMessageBox.confirm('删除此卡片？', '确认删除', { type: 'warning' });
  await del('/api/admin/icons/' + id);
  await store.loadAll();
  notifyHome();
  ElMessage.success('已删除，前台已同步');
}

async function moveGroup(id: number, dir: -1 | 1) {
  const idx = store.groups.findIndex(g => g.id === id);
  const other = store.groups[idx + dir];
  if (!other) return;
  await patch('/api/admin/groups/' + id, { sort: other.sort });
  await patch('/api/admin/groups/' + other.id, { sort: store.groups[idx].sort });
  await store.loadAll();
  notifyHome();
}

async function moveIcon(gid: number, id: number, dir: -1 | 1) {
  const g = store.groups.find(x => x.id === gid);
  const items = g.items || [];
  const idx = items.findIndex(it => it.id === id);
  const other = items[idx + dir];
  if (!other) return;
  await patch('/api/admin/icons/' + id, { sort: other.sort });
  await patch('/api/admin/icons/' + other.id, { sort: items[idx].sort });
  await store.loadAll();
  notifyHome();
}

function onDragStart(kind: 'group' | 'icon', id: number, gid?: number) {
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
        <div class="sub">拖拽分组或卡片调整顺序</div>
      </div>
      <el-button type="success" @click="gEdit = 'new'">＋ 添加分组</el-button>
    </div>

    <el-empty v-if="!store.groups.length" description="还没有分组，点右上角「添加分组」开始" />

    <div v-for="g in store.groups" :key="g.id" class="sp-card group" draggable="true"
         :class="dragClass('group')"
         @dragstart="onDragStart('group', g.id)" @dragover.prevent @drop="onDrop('group', g.id)">
      <div class="g-head">
        <span class="g-icon">📁</span>
        <div class="g-title">
          {{ g.title }}
          <span class="g-count">{{ g.icon_count || 0 }} 张卡片</span>
        </div>
        <div class="g-ops">
          <el-button size="small" @click="moveGroup(g.id, -1)">↑</el-button>
          <el-button size="small" @click="moveGroup(g.id, 1)">↓</el-button>
          <el-button size="small" @click="gEdit = g">编辑</el-button>
          <el-button size="small" type="danger" plain @click="delGroup(g.id)">删除</el-button>
        </div>
      </div>

      <div class="g-items">
        <div class="item-row" v-for="it in g.items" :key="it.id" draggable="true"
             :class="dragClass('icon')"
             @dragstart="onDragStart('icon', it.id, g.id)" @dragover.prevent @drop="onDrop('icon', it.id, g.id)">
          <div class="item-ico" :style="{ background: it.background_color || '#2b3036' }">
            <img v-if="it.icon_url" :src="it.icon_url" />
            <span v-else>{{ (it.title || '?').charAt(0).toUpperCase() }}</span>
          </div>
          <div class="item-info">
            <div class="item-name">{{ it.title }}</div>
            <div class="item-url">{{ it.url || '（无网址）' }}</div>
          </div>
          <div class="item-ops">
            <el-button size="small" @click="moveIcon(g.id, it.id, -1)">↑</el-button>
            <el-button size="small" @click="moveIcon(g.id, it.id, 1)">↓</el-button>
            <el-button size="small" @click="iEdit = { gid: g.id, it }">编辑</el-button>
            <el-button size="small" type="danger" plain @click="delIcon(it.id)">删除</el-button>
          </div>
        </div>
        <el-button size="small" class="add-item" @click="iEdit = { gid: g.id, it: null }">＋ 添加卡片</el-button>
      </div>
    </div>

    <GroupEditModal v-if="gEdit" :model-value="gEdit" @close="gEdit = null" @save="saveGroup" />
    <IconEditModal v-if="iEdit" :model-value="iEdit" :groups="store.groups" @close="iEdit = null" @save="saveIcon" />
  </div>
</template>

<style scoped>
  .group { padding: 0; overflow: hidden; }
  [draggable] { cursor: grab; }
  [draggable]:active { cursor: grabbing; }
  .drag-target { outline: 1.5px dashed var(--sp-accent); outline-offset: -1.5px; }

  .g-head {
    display: flex; align-items: center; gap: 12px;
    padding: 13px 18px;
    background: var(--sp-card-in);
    border-bottom: 1px solid var(--sp-card-border);
  }
  .g-icon { font-size: 17px; }
  .g-title { font-weight: 600; font-size: 14.5px; flex: 1; display: flex; align-items: center; gap: 9px; }
  .g-count {
    font-size: 11.5px; font-weight: 400; color: var(--sp-dim);
    background: var(--sp-chip-bg); padding: 1px 8px; border-radius: 20px;
  }
  .g-ops { display: flex; gap: 6px; }

  .g-items { padding: 14px 16px 16px; }
  .item-row {
    display: flex; align-items: center; gap: 12px;
    background: var(--sp-card-in); border: 1px solid transparent;
    border-radius: 10px; padding: 9px 12px; margin-bottom: 8px;
    transition: background .15s;
  }
  .item-row:hover { background: var(--sp-hover); }
  .item-ico {
    flex: 0 0 38px; width: 38px; height: 38px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-weight: 700; font-size: 16px; overflow: hidden;
  }
  .item-ico img { width: 100%; height: 100%; object-fit: cover; }
  .item-info { flex: 1; min-width: 0; }
  .item-name { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-url { font-size: 12px; color: var(--sp-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-ops { display: flex; gap: 6px; }
  .add-item { width: 100%; border-style: dashed; }
</style>
