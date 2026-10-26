<script setup lang="ts">
import { reactive, watch } from 'vue';
import { type Group } from '../store';

const props = defineProps<{ modelValue: Group | 'new' }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', g: any): void }>();

const f = reactive({
  title: '', description: '', card_style: 'info', sort: 0, public_hide: 0,
});

watch(() => props.modelValue, v => {
  if (v && v !== 'new') Object.assign(f, v);
  else Object.assign(f, { title: '', description: '', card_style: 'info', sort: 0, public_hide: 0 });
}, { immediate: true });

function save() {
  if (!f.title.trim()) return;
  emit('save', { ...f, title: f.title.trim() });
}
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
          <el-option value="grid" label="网格样式" />
          <el-option value="hide" label="前台隐藏此分组" />
        </el-select>
      </el-form-item>
      <el-form-item label="排序（数字越小越靠前）">
        <el-input-number v-model="f.sort" :min="0" style="width:100%" />
      </el-form-item>
      <el-form-item>
        <el-checkbox v-model="f.public_hide" :true-value="1" :false-value="0">前台隐藏此分组</el-checkbox>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="success" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
