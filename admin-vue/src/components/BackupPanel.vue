<script setup lang="ts">
import { get, post } from '../api';
import { notifyHome } from '../lib/notify';
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

/* Vue 3 模板表达式里访问不到 document（不是允许的全局白名单成员），
   内联写 @click="document.getElementById(...)" 会静默报错、文件框弹不出来，
   必须包成 setup 里的函数再绑定。 */
function pickFile() {
  document.getElementById('impFile')?.click();
}

async function importFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  try {
    let text = await f.text();
    /* Windows 记事本另存的 UTF-8 常带 BOM，不剥离 JSON.parse 会直接炸 */
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let obj: any;
    try { obj = JSON.parse(text); }
    catch { throw new Error('文件不是有效的 JSON，请选择本系统导出的备份文件'); }
    if (!obj || obj.app !== 'udenav' || !Array.isArray(obj.groups)) {
      throw new Error('这不是本系统导出的备份文件（缺少 udenav 标识或分组数据）');
    }
    const r = await post<any>('/api/admin/import', { ...obj, confirm: 'restore' });
    ElMessage.success(`已导入 ${r.groups} 组 / ${r.icons} 张卡片，前台已同步`);
    notifyHome();
  } catch (err: any) {
    /* 错误提示保留 8 秒：太短的话还没看清就消失了 */
    ElMessage.error({ message: '导入失败：' + (err?.message || '未知错误'), duration: 8000, showClose: true });
  }
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
        <el-button @click="pickFile">导入 JSON</el-button>
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
