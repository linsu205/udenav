<script setup lang="ts">
import { reactive, onMounted, watch } from 'vue';
import { useStore } from '../store';
import { put, post } from '../api';
import { applyTheme } from '../lib/theme';
import { ElMessage } from 'element-plus';

const store = useStore();
const f = reactive({
  logo_text: '', favicon: '', theme: 'dark', background_image: '', background_blur: 10, background_mask: 0.2,
  margin_top: 6, icon_style: 'info', footer: '', search_box_show: 1, search_engines: [] as any[],
});

function fill() {
  if (!store.config) return;
  Object.assign(f, store.config);
  if (!f.search_engines?.length) f.search_engines = [
    { name: '百度', url: 'https://www.baidu.com/s?wd=%s' },
    { name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
    { name: 'Google', url: 'https://www.google.com/search?q=%s' },
  ];
}

onMounted(fill);
watch(() => store.config, fill);
// 在后台改主题时即时预览（无需保存刷新）
watch(() => f.theme, t => applyTheme(t));

async function save() {
  await put('/api/admin/config', f);
  ElMessage.success('配置已保存');
  // 通知主页刷新
  if (window.self !== window.top) {
    setTimeout(() => window.top.postMessage({ type: 'udenav:refresh' }, '*'), 600);
  } else {
    setTimeout(() => location.reload(), 600);
  }
}

async function uploadFav(opt: any) {
  const fd = new FormData();
  fd.append('file', opt.file);
  const r = await post<any>('/api/admin/upload', fd);
  f.favicon = r.icon_url;
  ElMessage.success('图标已上传');
}

async function uploadBg(opt: any) {
  const fd = new FormData();
  fd.append('file', opt.file);
  const r = await post<any>('/api/admin/upload', fd);
  f.background_image = r.icon_url;
  ElMessage.success('上传成功');
}

function addEngine() { f.search_engines.push({ name: '', url: '' }); }
function rmEngine(i: number) { f.search_engines.splice(i, 1); }
function moveEngine(i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= f.search_engines.length) return;
  const arr = f.search_engines;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>页面配置</h2>
        <div class="sub">首页标题、壁纸、搜索框等外观设置</div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">基础</div>
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="首页标题">
          <el-input v-model="f.logo_text" placeholder="udenav" />
        </el-form-item>
        <el-form-item label="网站图标 (Favicon)">
          <div style="display:flex;align-items:center;gap:12px;width:100%">
            <el-input v-model="f.favicon" placeholder="粘贴图片 URL，或点右边上传" />
            <el-upload :show-file-list="false" accept="image/*" :http-request="uploadFav" style="flex:none"><el-button>上传图标</el-button></el-upload>
            <img v-if="f.favicon" :src="f.favicon" alt="icon" style="width:28px;height:28px;border-radius:6px;object-fit:contain;background:var(--sp-preview-bg);flex:none" />
          </div>
        </el-form-item>
        <el-form-item label="页脚文字">
          <el-input v-model="f.footer" placeholder="留空不显示" />
        </el-form-item>
        <el-form-item>
          <el-checkbox v-model="f.search_box_show" :true-value="1" :false-value="0">显示搜索框</el-checkbox>
        </el-form-item>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">壁纸</div>
      <el-form label-position="top" @submit.prevent>
        <el-row :gutter="18">
          <el-col :span="7"><el-form-item label="主题"><el-select v-model="f.theme" style="width:100%"><el-option value="dark" label="深色" /><el-option value="light" label="浅色" /></el-select></el-form-item></el-col>
          <el-col :span="11"><el-form-item label="壁纸地址"><el-input v-model="f.background_image" placeholder="留空用纯色背景" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="上传图片"><el-upload :show-file-list="false" accept="image/*" :http-request="uploadBg"><el-button style="width:100%">选择图片</el-button></el-upload></el-form-item></el-col>
        </el-row>
        <el-row :gutter="18">
          <el-col :span="6"><el-form-item label="壁纸模糊"><el-input-number v-model="f.background_blur" :min="0" :max="30" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="遮罩不透明度"><el-input-number v-model="f.background_mask" :min="0" :max="1" :step="0.05" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="顶部留白 (vh)"><el-input-number v-model="f.margin_top" :min="0" :max="30" style="width:100%" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="卡片样式"><el-select v-model="f.icon_style" style="width:100%"><el-option value="info" label="横排信息卡" /><el-option value="grid" label="网格" /></el-select></el-form-item></el-col>
        </el-row>
      </el-form>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">搜索引擎</div>
      <div v-for="(e, i) in f.search_engines" :key="i" class="engine-row">
        <el-input v-model="e.name" placeholder="名称" style="width:150px;flex:none" />
        <el-input v-model="e.url" placeholder="URL 模板（%s 替换关键词）" />
        <el-button @click="moveEngine(i, -1)" :disabled="i === 0" style="flex:none;width:36px">↑</el-button>
        <el-button @click="moveEngine(i, 1)" :disabled="i === f.search_engines.length - 1" style="flex:none;width:36px">↓</el-button>
        <el-button type="danger" plain @click="rmEngine(i)">删除</el-button>
      </div>
      <div style="font-size:12px;color:var(--sp-dim);margin:-4px 0 8px">排在第 1 位的是访客页默认选中的搜索引擎</div>
      <div style="display:flex;gap:10px;margin-top:6px">
        <el-button @click="addEngine">＋ 添加搜索引擎</el-button>
        <el-button type="success" @click="save">保存配置</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .engine-row { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
  @media (max-width: 768px) {
    .engine-row { flex-wrap: wrap; }
    .engine-row .el-input:first-child { width: 100% !important; }
  }
</style>
