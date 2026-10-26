<script setup lang="ts">
import { get, post } from '../api';
import { ElMessage } from 'element-plus';

async function exportAll() {
  const j = await get('/api/admin/export');
  const blob = new Blob([JSON.stringify(j, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'udenav-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  ElMessage.success('已导出');
}

async function importFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    const r = await post<any>('/api/admin/import', { ...obj, confirm: 'restore' });
    ElMessage.success(`已导入 ${r.groups} 组 / ${r.icons} 张`);
  } catch (err: any) { ElMessage.error('导入失败：' + err.message); }
  (e.target as HTMLInputElement).value = '';
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>备份与导入</h2>
        <div class="sub">导出 JSON 到本地做备份，需要时再导入恢复</div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">数据备份</div>
      <div style="display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap">
        <el-button type="success" @click="exportAll">导出全部数据（JSON）</el-button>
        <input type="file" accept="application/json" style="display:none" id="impFile" @change="importFile">
        <el-button @click="document.getElementById('impFile')?.click()">导入 JSON</el-button>
      </div>
      <el-alert type="info" :closable="false" show-icon>
        <template #title>
          数据全部存 D1 数据库。所有内容（配置 / 分组 / 卡片 / 图片）都包含在一个 JSON 文件里，
          建议每次大改后导出一份保存到本地。
        </template>
      </el-alert>
    </div>
  </div>
</template>
