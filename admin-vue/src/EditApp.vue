<script setup lang="ts">
/**
 * 前台右键「编辑」用的独立入口。
 *
 * 它只做一件事：把 IconEditModal 挂起来。不包含登录页、侧栏、分组列表、
 * 加载骨架 —— 那些都是后台面板的东西。所以点了编辑，屏幕上从第一帧起
 * 就只有这张卡的编辑弹窗，后台面板根本不会被创建，也不存在「闪一下」。
 *
 * 挂载点由访客页提供（public/index.html 的 #editRoot），与后台面板的
 * #adminRoot 是两个互不相干的 Vue 实例。
 */
import { ref, onMounted, computed } from 'vue';
import { get, post, patch } from './api';
import { ElMessage } from 'element-plus';
import IconEditModal from './components/IconEditModal.vue';
import { notifyHome } from './lib/notify';
import type { Group, IconItem } from './store';

/* id = 0 表示「新增」：同一个弹窗换个标题直接加卡片，
   省得为加一条导航先去后台面板里翻分组。
   init 可选：新增模式的预填数据（如首页「AI 添加」带进来的 AI 补全结果）。
   onSaved 可选：保存成功后的回调（首页「AI 添加」用来清空搜索栏并回退展示全部导航） */
const props = defineProps<{ gid: number; id: number; init?: Record<string, any>; onSaved?: () => void }>();
const emit = defineEmits<{ (e: 'done'): void }>();

const isAdd = computed(() => !props.id);
/* 仅在新增模式下把 init 透传给编辑弹窗；编辑已有卡片时不接受预填，避免覆盖原数据 */
const initItem = computed(() => (isAdd.value ? props.init : undefined));

const ready = ref(false);
const item = ref<IconItem | null>(null);
const groups = ref<Group[]>([]);

function done() {
  emit('done');
}

onMounted(async () => {
  try {
    const [ic, gr] = await Promise.all([
      get<any>('/api/admin/icons?group_id=' + props.gid),
      get<any>('/api/admin/groups'),
    ]);
    groups.value = gr.groups || [];
    if (!isAdd.value) {
      const found = (ic.icons || []).find((x: any) => x.id === props.id);
      if (!found) {
        ElMessage.warning('这张卡片不存在了，可能已被删除');
        done();
        return;
      }
      item.value = found;
    }
    ready.value = true;
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      /* 会话过期：交给访客页弹登录框，别在这层空白着 */
      window.dispatchEvent(new CustomEvent('udenav:login-required'));
    } else {
      ElMessage.error('加载卡片失败：' + (e?.message || '请重试'));
    }
    done();
  }
});

async function save(it: any) {
  try {
    if (isAdd.value) await post('/api/admin/icons', { ...it, group_id: props.gid });
    else await patch('/api/admin/icons/' + props.id, it);
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      window.dispatchEvent(new CustomEvent('udenav:login-required'));
      done();
      return;
    }
    ElMessage.error(e?.message || '保存失败，请重试');
    return; /* 保留弹窗和已填内容 */
  }
  done();
  notifyHome();
  /* 保存成功后的额外动作（如首页 AI 添加后清空搜索栏）：仅成功落库才触发 */
  props.onSaved?.();
  ElMessage.success(isAdd.value ? '已添加，前台已同步' : '已保存，前台已同步');
}
</script>

<template>
  <!-- 取数据那几十毫秒先铺一层和弹窗同色的遮罩，点下去就立刻有反馈，不会白屏一下 -->
  <div v-if="!ready" class="edit-veil"><i></i></div>
  <IconEditModal v-else :model-value="{ gid, it: item }" :groups="groups" :init="initItem" @close="done" @save="save" />
</template>

<style scoped>
  /* 和 IconEditModal 的遮罩同色（--el-overlay-color-lighter），层级也贴着它，
     这样「取数据 → 弹窗上屏」这一步只是把转圈换成卡片，背景不会亮一下再暗回去 */
  .edit-veil {
    position: fixed; inset: 0; z-index: 2500;
    display: flex; align-items: center; justify-content: center;
    background: var(--el-overlay-color-lighter, rgba(0, 0, 0, .5));
  }
  .edit-veil i {
    width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, .25);
    border-top-color: #fff;
    animation: vev .7s linear infinite;
  }
  @keyframes vev { to { transform: rotate(360deg); } }
</style>
