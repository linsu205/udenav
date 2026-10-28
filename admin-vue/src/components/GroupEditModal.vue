<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { type Group } from '../store';
import ModalShell from './ModalShell.vue';
import IIcon from './IIcon.vue';
import IconPickerPopover from './IconPickerPopover.vue';
import { ICON_LIBS, pushRecent } from '../lib/icon-lists';

const props = defineProps<{ modelValue: Group | 'new' }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'save', g: any): void }>();

/* 分组图标：只做在线图标（Iconify），标题前 19px 处渲染。
   不提供上传 —— 分组标题压在壁纸上，位图很难和图标的线条重量对齐，
   矢量图标能跟着文字颜色走，浅色壁纸上加投影也不会糊。 */
const QUICK = [
  { n: 'solar:star-bold', t: '常用' },
  { n: 'solar:widget-5-bold-duotone', t: '应用' },
  { n: 'solar:monitor-bold-duotone', t: '工作台' },
  { n: 'solar:book-bold-duotone', t: '文档' },
  { n: 'solar:code-square-bold-duotone', t: '开发' },
  { n: 'solar:server-square-bold-duotone', t: '运维' },
  { n: 'solar:chat-round-dots-bold-duotone', t: '社交' },
  { n: 'solar:videocamera-record-bold-duotone', t: '影音' },
  { n: 'solar:gamepad-bold-duotone', t: '游戏' },
  { n: 'solar:cloud-bold-duotone', t: '云服务' },
];

const f = reactive({
  title: '', description: '', card_style: 'info', sort: 0, public_hide: 0, public_show: 0,
  icon_type: 'iconify', icon_name: '', icon_url: '',
});

/* 输入过程中可能是半成品（没冒号、带空格），只在格式合法时才去取图标，
   否则每敲一个字符都会打一次 400 的代理请求 */
const ICON_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;
const iconOk = computed(() => ICON_RE.test(String(f.icon_name || '').trim()));

watch(() => props.modelValue, v => {
  if (v && v !== 'new') Object.assign(f, v);
  else Object.assign(f, {
    title: '', description: '', card_style: 'info', sort: 0, public_hide: 0, public_show: 0,
    icon_type: 'iconify', icon_name: '', icon_url: '',
  });
  /* 旧数据兼容：hide 曾是下拉选项，现已收敛为独立勾选框，编辑时自动归位 */
  if (f.card_style === 'hide') { f.card_style = 'info'; f.public_hide = 1; }
}, { immediate: true });

function pick(name: string) {
  f.icon_name = f.icon_name === name ? '' : name;   /* 再点一次取消，省得手动清空 */
  if (f.icon_name) f.icon_type = 'iconify';
}

function save() {
  if (!f.title.trim()) return;
  const icon_name = String(f.icon_name || '').trim();
  /* 存错了前台只会剩一个破图，这里先拦一道；留空是合法的（= 不显示图标） */
  if (icon_name && !ICON_RE.test(icon_name)) {
    ElMessage.warning('图标格式应为「前缀:图标名」，如 solar:star-bold');
    return;
  }
  /* 有图标名就归到 iconify（否则 public 接口按 icon_type 判断会返回空）；
     名字清空时不动 icon_type，避免把历史图片型图标一并抹掉 */
  if (icon_name) pushRecent(icon_name);   // 记住这次用的图标，下次从「最近使用」里直接挑
  emit('save', {
    ...f,
    title: f.title.trim(),
    icon_name,
    icon_type: icon_name ? 'iconify' : f.icon_type,
  });
}

/* 两个开关互斥：完全隐藏优先，勾了就没必要再谈免登录 */
function onShow(v: any) { if (v) f.public_hide = 0; }
function onHide(v: any) { if (v) f.public_show = 0; }
</script>

<template>
  <!-- 与卡片编辑弹窗同一套弹窗外壳：body 级独立遮罩层，不锁 body 滚动 -->
  <ModalShell title="分组信息" width="500px" @close="emit('close')">
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="分组名称 *">
        <el-input v-model="f.title" placeholder="例：AI 与工具" maxlength="30" />
      </el-form-item>
      <el-form-item label="描述（显示在标题旁）">
        <el-input v-model="f.description" maxlength="60" />
      </el-form-item>
      <el-form-item label="分组图标（显示在标题前）">
        <div class="gico">
          <!-- 预览块：格式没填对时给一个半透明的占位图标，而不是干瘪的空白框 -->
          <div class="gico-box" :class="{ empty: !iconOk }">
            <IIcon v-if="iconOk" :name="f.icon_name.trim()" :size="18" />
            <IIcon v-else name="solar:star-bold" :size="18" class="ghost" />
          </div>
          <el-input
            v-model="f.icon_name"
            clearable
            placeholder="格式 前缀:图标名，如 solar:star-bold（留空则不显示）"
          />
          <!-- 最近用过的图标：分组图标经常反复用同几个，点开直接挑，不用再拼名字 -->
          <IconPickerPopover @pick="(n: string) => (f.icon_name = n)" />
        </div>
        <div class="gico-quick">
          <button
            v-for="ic in QUICK"
            :key="ic.n"
            type="button"
            :class="{ on: f.icon_name === ic.n }"
            :title="ic.t + ' · ' + ic.n"
            @click="pick(ic.n)"
          >
            <IIcon :name="ic.n" :size="15" />
          </button>
        </div>
        <!-- 图标库入口：和卡片弹窗一致，改一处两边都变 -->
        <div class="gico-libs">
          <span class="gico-libs-t">图标库：</span>
          <a v-for="l in ICON_LIBS" :key="l.url" :href="l.url" target="_blank" rel="noopener">{{ l.label }}</a>
        </div>
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
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </ModalShell>
</template>

<style scoped>
  .vis { display: flex; flex-direction: column; gap: 2px; }
  .vis .tip {
    font-size: 12px; line-height: 1.5; color: var(--sp-dim);
    margin: -4px 0 8px 24px;
  }

  /* ---------------- 分组图标 ---------------- */
  .gico { display: flex; align-items: center; gap: 10px; width: 100%; }
  /* 加了「最近使用」按钮后输入框要能被压缩，否则 500px 弹窗里会被挤出去 */
  .gico :deep(.el-input) { min-width: 0; }
  .gico-box {
    flex: none; width: 34px; height: 34px; border-radius: 9px;
    display: flex; align-items: center; justify-content: center;
    color: var(--sp-text); background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .gico-box.empty { color: var(--sp-faint); }
  .gico-box .ghost { opacity: .3; }

  /* 常用图标快捷选：省得每次都去 iconify 站点查名字 */
  .gico-quick { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; margin-top: 9px; }
  .gico-quick button {
    width: 30px; height: 30px; padding: 0; border-radius: 8px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    color: var(--sp-dim); background: transparent; border: 1px solid var(--sp-border);
    transition: color .14s, background .14s, border-color .14s;
  }
  .gico-quick button:hover {
    color: var(--sp-text); background: var(--sp-hover); border-color: var(--sp-border-hover);
  }
  .gico-quick button.on {
    color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .10);
    border-color: rgba(var(--sp-accent-rgb), .40);
  }

  /* 图标库入口：小一号链接，跟在上面的快捷图标之后当「不够用就去库里找」的出口 */
  .gico-libs {
    display: flex; align-items: center; gap: 4px 11px; flex-wrap: wrap; width: 100%;
    margin-top: 9px; font-size: 12px;
  }
  .gico-libs-t { color: var(--sp-dim); }
  .gico-libs a {
    color: var(--sp-accent); text-decoration: none; font-weight: 500;
  }
  .gico-libs a:hover { text-decoration: underline; }
</style>
