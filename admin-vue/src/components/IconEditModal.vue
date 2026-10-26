<script setup lang="ts">
import { reactive, computed, watch } from 'vue';
import { post } from '../api';
import { ElMessage } from 'element-plus';
import { type Group, type IconItem } from '../store';

const props = defineProps<{
  modelValue: { gid: number; it: IconItem | null };
  groups: Group[];
}>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', it: any): void }>();

const isAdd = computed(() => !props.modelValue.it);

const f = reactive({
  title: '', url: '', lan_url: '', description: '', icon_type: 'color',
  icon_url: '', icon_name: '', background_color: '', open_method: 2, sort: 0, group_id: 0,
});

const previewIconUrl = computed(() => f.icon_type === 'data' ? f.icon_url : '');
const previewChar = computed(() => (f.title || '?').charAt(0).toUpperCase());

watch(() => props.modelValue, v => {
  if (v.it) {
    Object.assign(f, v.it);
    if (v.it.icon_type === 'r2') { f.icon_type = 'data'; }
  } else {
    Object.assign(f, { title: '', url: '', lan_url: '', description: '', icon_type: 'color', icon_url: '', icon_name: '', background_color: '', open_method: 2, sort: 0, group_id: v.gid });
  }
}, { immediate: true });

async function uploadIcon(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  try {
    const r = await post<any>('/api/admin/upload', fd);
    f.icon_url = r.icon_url;
    ElMessage.success('上传成功');
  } catch (err: any) { ElMessage.error('上传失败：' + err.message); }
}

function save() {
  if (!f.title.trim()) return ElMessage.warning('标题不能为空');
  if (!f.url.trim()) return ElMessage.warning('默认地址不能为空');
  emit('save', { ...f, title: f.title.trim(), url: f.url.trim() });
}
</script>

<template>
  <el-dialog :model-value="true" :title="isAdd ? '添加卡片' : '编辑卡片'" width="640px" @close="emit('close')" :close-on-click-modal="false">
    <!-- 效果预览 -->
    <div style="background:var(--sp-preview-bg);border:1px dashed var(--sp-preview-border);border-radius:12px;padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;min-height:70px">
      <div style="flex:0 0 46px;width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;overflow:hidden;font-size:20px"
           :style="{ background: f.background_color }">
        <img v-if="previewIconUrl" :src="previewIconUrl" style="width:100%;height:100%;object-fit:cover" />
        <span v-else>{{ previewChar }}</span>
      </div>
      <div>
        <div style="font-size:15px;font-weight:600">{{ f.title || '卡片标题' }}</div>
        <div style="font-size:12px;color:var(--sp-dim);margin-top:3px">{{ f.description || '描述信息' }}</div>
      </div>
    </div>

    <el-form label-position="top" @submit.prevent>
      <!-- 图标风格 tab -->
      <el-radio-group v-model="f.icon_type" style="margin-bottom:16px">
        <el-radio-button value="color">文字</el-radio-button>
        <el-radio-button value="data">图片</el-radio-button>
        <el-radio-button value="iconify">在线图标</el-radio-button>
      </el-radio-group>

      <!-- 图标内容 -->
      <div v-if="f.icon_type === 'color'">
        <el-form-item label="使用标题首字作为图标">
          <el-input :model-value="previewChar" readonly />
        </el-form-item>
      </div>
      <div v-else-if="f.icon_type === 'data'">
        <el-form-item label="图像地址">
          <div style="display:flex;gap:8px">
            <el-input v-model="f.icon_url" placeholder="粘贴图片 URL 或本地上传" />
            <input type="file" accept="image/*" style="display:none" id="iconFile" @change="uploadIcon">
            <el-button @click="document.getElementById('iconFile')?.click()">📁 本地上传</el-button>
          </div>
        </el-form-item>
      </div>
      <div v-else-if="f.icon_type === 'iconify'">
        <el-form-item label="在线图标（Iconify 名）">
          <el-input v-model="f.icon_name" placeholder="例：ri:home-fill / mdi:github" />
        </el-form-item>
        <div style="color:var(--sp-dim);font-size:12px;margin:-6px 0 12px">格式：前缀:图标名，如 ri:home-fill、mdi:github、fa:github。留空则用标题首字。</div>
      </div>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="标题 *">
            <el-input v-model="f.title" maxlength="20" show-word-limit />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="描述信息">
            <el-input v-model="f.description" maxlength="100" show-word-limit />
          </el-form-item>
        </el-col>
      </el-row>
      <el-form-item label="默认地址 *">
        <el-input v-model="f.url" placeholder="https://" />
      </el-form-item>
      <el-form-item label="内网地址（可选）">
        <el-input v-model="f.lan_url" placeholder="http://192.168.x.x" />
      </el-form-item>
      <el-form-item label="打开方式">
        <el-select v-model="f.open_method" style="width:100%">
          <el-option :value="1" label="当前页打开" />
          <el-option :value="2" label="新标签打开" />
          <el-option :value="3" label="弹窗打开" />
        </el-select>
      </el-form-item>

      <el-collapse style="background:var(--sp-preview-bg);border:1px solid var(--sp-preview-border);border-radius:10px">
        <el-collapse-item title="更多选项（背景色、排序、所属分组）" name="more">
          <el-row :gutter="16">
            <el-col :span="8">
              <el-form-item label="图标背景色">
                <el-color-picker v-model="f.background_color" show-alpha />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="排序">
                <el-input-number v-model="f.sort" :min="0" style="width:100%" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="所属分组">
                <el-select v-model="f.group_id" style="width:100%" :disabled="!isAdd">
                  <el-option v-for="g in groups" :key="g.id" :value="g.id" :label="g.title" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
        </el-collapse-item>
      </el-collapse>
    </el-form>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="success" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
