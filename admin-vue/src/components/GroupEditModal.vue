<script setup lang="ts">
import { reactive, watch } from 'vue';
import { type Group } from '../store';

const props = defineProps<{ modelValue: Group | 'new' }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', g: any): void }>();

const f = reactive({
  title: '', description: '', card_style: 'info', sort: 0, public_hide: 0, public_show: 0,
});

watch(() => props.modelValue, v => {
  if (v && v !== 'new') Object.assign(f, v);
  else Object.assign(f, { title: '', description: '', card_style: 'info', sort: 0, public_hide: 0, public_show: 0 });
  /* 旧数据兼容：hide 曾是下拉选项，现已收敛为独立勾选框，编辑时自动归位 */
  if (f.card_style === 'hide') { f.card_style = 'info'; f.public_hide = 1; }
}, { immediate: true });

function save() {
  if (!f.title.trim()) return;
  emit('save', { ...f, title: f.title.trim() });
}

/* 两个开关互斥：完全隐藏优先，勾了就没必要再谈免登录 */
function onShow(v: any) { if (v) f.public_hide = 0; }
function onHide(v: any) { if (v) f.public_show = 0; }
</script>

<template>
  <el-dialog :model-value="true" title="分组信息" width="500px" @close="emit('close')" :close-on-click-modal="false">
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="分组名称 *">
        <el-input v-model="f.title" placeholder="例：AI 与工具" maxlength="30" />
      </el-form-item>
      <el-form-item label="描述（显示在标题旁）">
        <el-input v-model="f.description" maxlength="60" />
      </el-form-item>
      <el-form-item label="卡片样式">
        <el-select v-model="f.card_style" style="width:100%">
          <el-option value="info" label="横排信息卡（默认）" />
          <el-option value="icon" label="小图标" />
        </el-select>
      </el-form-item>
      <el-form-item label="排序（数字越小越靠前）">
        <el-input-number v-model="f.sort" :min="0" style="width:100%" />
      </el-form-item>
      <el-form-item label="可见范围">
        <div class="vis">
          <el-checkbox v-model="f.public_show" :true-value="1" :false-value="0" @change="onShow">免登录可见</el-checkbox>
          <div class="tip">勾选后，未登录的访客也能看到这个分组；不勾选则只有登录后才显示。</div>
          <el-checkbox v-model="f.public_hide" :true-value="1" :false-value="0" @change="onHide">前台完全隐藏（登录后也不显示）</el-checkbox>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="success" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
  .vis { display: flex; flex-direction: column; gap: 2px; }
  .vis .tip {
    font-size: 12px; line-height: 1.5; color: var(--sp-text-dim);
    margin: -4px 0 8px 24px;
  }
</style>
