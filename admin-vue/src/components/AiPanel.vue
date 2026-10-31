<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { get, put, post, del } from '../api';
import { ElMessage, ElMessageBox } from 'element-plus';
import IIcon from './IIcon.vue';
import { MagicStick, Key, Connection, DataLine, Refresh, Plus } from '@element-plus/icons-vue';

/* 预设服务商：「内网通道」走本站 Cloudflare 账号自带的 Workers AI 绑定（免密钥、不产生公网请求），
   其余走 OpenAI 兼容的 /chat/completions，所以「自定义」也能接任何自建服务（vLLM、one-api 网关、公司内网模型）。 */
const PRESETS = [
  {
    key: 'cf', label: 'Cloudflare Workers AI（内置·免密钥）', base_url: '', model: '@cf/meta/llama-3.1-8b-instruct-fp8',
    tip: '用本站 Cloudflare 账号自带的 AI 额度，不用密钥、不走外网；第三方中转站报 1015 时用这个最稳',
    provider: 'cf' as const,
  },
  {
    key: 'deepseek', label: 'DeepSeek', base_url: 'https://api.deepseek.com/v1', model: 'deepseek-chat',
    tip: '便宜、中文好。密钥在 platform.deepseek.com 申请', provider: 'openai' as const,
  },
  {
    key: 'dashscope', label: '通义千问（阿里云百炼）', base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus',
    tip: '密钥在阿里云百炼控制台申请，必须用「兼容模式」这个地址', provider: 'openai' as const,
  },
  {
    key: 'zhipu', label: '智谱 GLM', base_url: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash',
    tip: 'glm-4-flash 有免费额度，适合先试水', provider: 'openai' as const,
  },
  {
    key: 'moonshot', label: 'Kimi（月之暗面）', base_url: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k',
    tip: '长文本见长，补全卡片用不上这么长的上下文', provider: 'openai' as const,
  },
  {
    key: 'custom', label: '自定义（OpenAI 兼容）', base_url: '', model: '',
    tip: '填到 /v1 就行；粘完整 /v1/chat/completions 也会自动识别', provider: 'openai' as const,
  },
] as const;

const loading = ref(true);
const saving = ref(false);
const testing = ref(false);
const info = ref<any>(null);

const form = reactive({ name: '', switch_on: true, base_url: '', model: '', daily_limit: 50, provider: 'openai' as 'openai' | 'cf' });
const keyInput = ref('');
const preset = ref<string>('custom');
/* 模型库：点「保存设置」会自动记一条，之后可在这里直接切换 / 编辑 / 删除 */
const models = ref<any[]>([]);
const activeId = ref('');
/** 非空表示正在编辑某条已有记录，保存时更新那条而不是新建 */
const editingId = ref('');
/** 正在跑连通性测试的记录 id；空表示没在测。用来给对应行显示转圈、并锁住其它按钮 */
const testingId = ref('');
/** 服务商表单改弹窗：只在「新增 / 编辑」时打开，保存成功后自动关闭 */
const dialogOpen = ref(false);

const curPreset = computed(() => PRESETS.find((p) => p.key === preset.value) || PRESETS[PRESETS.length - 1]);
/* 内置通道没有地址和密钥，界面上就把这两栏收起来，免得用户以为漏填 */
const isBuiltin = computed(() => form.provider === 'cf');
/** 正在编辑的那条记录；新增时为空 */
const editingRec = computed(() => models.value.find((m: any) => m.id === editingId.value) || null);
/* 弹窗里的密钥态以「正在编辑的那条记录」为准，新增时退回全局配置 ——
   否则新增时会显示上一条生效记录的密钥提示，看着像已经填过 */
const dlgKeyHint = computed(() =>
  editingId.value ? String(editingRec.value?.key_hint || '') : String(info.value?.key_hint || ''),
);
const dlgConfigured = computed(() => !!dlgKeyHint.value);

function matchPreset(provider: string, base: string, model: string): string {
  if (provider === 'cf') return 'cf';
  const hit = PRESETS.find((p) => p.provider === 'openai' && p.base_url && p.base_url === base);
  return hit ? hit.key : 'custom';
}

const state = computed(() => {
  const r = info.value;
  if (!r) return { cls: 'off', text: '读取中' };
  if (r.provider === 'cf' && !r.ai_binding) return { cls: 'off', text: '缺少 AI 绑定' };
  if (!r.configured) return { cls: 'off', text: '未配置密钥' };
  if (!r.switch_on) return { cls: 'off', text: '已关闭' };
  return { cls: 'on', text: '已启用' };
});

async function load() {
  loading.value = true;
  try {
    const r: any = await get('/api/admin/ai');
    info.value = r;
    form.switch_on = !!r.switch_on;
    form.base_url = r.base_url || '';
    form.model = r.model || '';
    form.daily_limit = Number(r.daily_limit) || 50;
    form.provider = r.provider === 'cf' ? 'cf' : 'openai';
    preset.value = matchPreset(form.provider, form.base_url, form.model);
    /* 模型库随配置一起返回，省一次请求 */
    models.value = Array.isArray(r.models?.list) ? r.models.list : [];
    activeId.value = String(r.models?.active_id || '');
    /* 备注名取自「当前生效的那条记录」；正在编辑别的记录时不要覆盖 */
    if (!editingId.value) {
      const act = models.value.find((m: any) => m.id === activeId.value);
      form.name = act?.name || '';
    }
  } catch (e: any) {
    ElMessage.error('读取 AI 配置失败：' + (e?.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

/* 换服务商只改「通道 + 地址 + 默认模型」，密钥不动 —— 用户可能只是想换个模型试试 */
function applyPreset(k: string) {
  preset.value = k;
  const p = PRESETS.find((x) => x.key === k);
  if (!p) return;
  form.provider = p.provider;
  /* 预设本身没给地址/模型时（内置通道、自定义）要清空输入框：
     不清会残留上一个服务商的值，看着像已配置，保存时还会被一起提交 */
  form.base_url = p.base_url || '';
  form.model = p.model || '';
  /* 输入框里没提交的密钥草稿属于上一个服务商，一起清掉，避免误发 */
  keyInput.value = '';
}

async function save() {
  /* 内置通道不需要密钥；自定义通道没密钥就别让开 */
  if (form.switch_on && !isBuiltin.value && !dlgConfigured.value && !keyInput.value.trim()) {
    return ElMessage.warning('开启前请先填写 API 密钥');
  }
  saving.value = true;
  try {
    const body: any = {
      provider: form.provider,
      enabled: form.switch_on,
      base_url: form.base_url,
      model: form.model,
      daily_limit: form.daily_limit,
      /* 有 id = 更新那条记录；没有就按「通道+地址+模型」去重后新建 */
      id: editingId.value || undefined,
      name: form.name.trim(),
    };
    /* 不传 key 表示「保持原密钥」，避免每次保存设置都把密钥清空 */
    if (keyInput.value.trim()) body.key = keyInput.value.trim();
    const r: any = await put('/api/admin/ai', body);
    info.value = r;
    /* 服务端会把「粘进来的完整 endpoint」收成 base，回显以服务端为准，免得输入框和实际请求不一致 */
    if (r?.base_url) form.base_url = r.base_url;
    if (r?.model) form.model = r.model;
    if (Number(r?.daily_limit) > 0) form.daily_limit = Number(r.daily_limit);
    /* 保存即写入模型库，直接用接口回传的列表刷新，省一次请求 */
    models.value = Array.isArray(r.models?.list) ? r.models.list : [];
    activeId.value = String(r.models?.active_id || '');
    /* 保存即生效，所以之后的表单就附着在刚写入/更新的这条记录上 */
    editingId.value = activeId.value;
    keyInput.value = '';
    /* 保存完就关掉弹窗，记录列表随即刷新，不用再点一次关闭 */
    dialogOpen.value = false;
    ElMessage.success('已保存');
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'));
  } finally {
    saving.value = false;
  }
}

async function clearKey() {
  try {
    await ElMessageBox.confirm('清除后 AI 补全将不可用，需要重新填写密钥才能恢复。确定清除？', '清除密钥', {
      type: 'warning', confirmButtonText: '清除', cancelButtonText: '取消', lockScroll: false,
    });
  } catch { return; }
  try {
    /* 带上正在编辑的记录 id，否则清掉的是全局 ai_cfg（也就是上一条生效记录）的密钥 */
    const r: any = await put('/api/admin/ai', { key: 'clear', id: editingId.value || undefined });
    info.value = r;
    keyInput.value = '';
    ElMessage.success('密钥已清除');
  } catch (e: any) {
    ElMessage.error('清除失败：' + (e?.message || '未知错误'));
  }
}

/* ---------- 模型记录：编辑 / 切换 / 删除 ----------
   「编辑」把记录填回上面的表单并记住 id，之后点「保存设置」= 更新这条；
   没点编辑就改表单保存，则按「通道+地址+模型」去重后新建一条。 */

/** 只把表单清回「新增」默认值，不开弹窗 */
function resetForm() {
  editingId.value = '';
  form.name = '';
  form.switch_on = true;
  form.daily_limit = 50;
  applyPreset('custom');
  keyInput.value = '';
}

function editRecord(m: any) {
  editingId.value = m.id;
  form.name = m.name || '';
  form.provider = m.provider === 'cf' ? 'cf' : 'openai';
  form.base_url = m.base_url || '';
  form.model = m.model || '';
  form.daily_limit = Number(m.daily_limit) || 50;
  /* 启用状态也跟着记录走，否则编辑 B 时会沿用当前生效记录 A 的开关 */
  form.switch_on = m.enabled !== false;
  preset.value = matchPreset(form.provider, form.base_url, form.model);
  /* 接口只回密钥末四位，编辑时输入框是空的；要换密钥就重新粘一次 */
  keyInput.value = '';
  dialogOpen.value = true;
}

/** 新增：表单清空后打开弹窗 */
function newRecord() {
  resetForm();
  dialogOpen.value = true;
}

/** 跑一次连通性测试；不抛错，把结果文案交给调用方决定怎么提示 */
async function runTest(id = ''): Promise<{ ok: boolean; text: string }> {
  testingId.value = id;
  try {
    const r: any = await post('/api/admin/ai/test', id ? { id } : {});
    return { ok: true, text: `连接正常 · ${r.model} · ${r.ms} ms` };
  } catch (e: any) {
    return { ok: false, text: '连接失败：' + (e?.message || '未知错误') };
  } finally {
    testingId.value = '';
  }
}

/** 列表行尾的「测试」：只测这一条，不影响当前生效配置 */
async function testRecord(m: any) {
  const r = await runTest(m.id);
  if (r.ok) ElMessage.success(r.text);
  else ElMessage.error(r.text);
}

async function switchRecord(m: any) {
  if (m.id === activeId.value) return;
  try {
    await post('/api/admin/ai/models/active', { id: m.id });
    /* 切换完顺手测一次连通性，把「切换结果 + 测试结果」合成一条提示，
       省得用户还要再点一次才知道这个模型到底能不能用 */
    const t = await runTest(m.id);
    if (t.ok) ElMessage.success(`已切换到「${m.name}」· ${t.text}`);
    else ElMessage.warning(`已切换到「${m.name}」，但${t.text}`);
    await load();
  } catch (err: any) {
    ElMessage.error('切换失败：' + (err?.message || '未知错误'));
  }
}

async function removeRecord(m: any) {
  try {
    await ElMessageBox.confirm(`删除后「${m.name}」这条记录不可恢复。确定删除？`, '删除模型记录', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', lockScroll: false,
    });
  } catch { return; }
  try {
    const r: any = await del('/api/admin/ai/models?id=' + encodeURIComponent(m.id));
    models.value = Array.isArray(r.list) ? r.list : [];
    activeId.value = String(r.active_id || '');
    /* 删掉的正是正在编辑的那条时退出编辑态；这里只清表单，不要把弹窗重新打开 */
    if (editingId.value === m.id) resetForm();
    ElMessage.success('已删除');
  } catch (err: any) {
    ElMessage.error('删除失败：' + (err?.message || '未知错误'));
  }
}

async function testConn() {
  if (!dlgConfigured.value) return ElMessage.warning('先填密钥并保存，再测试');
  testing.value = true;
  try {
    /* 编辑已有记录时测那一条；新增时还没落库，只能测当前生效配置 */
    const r: any = await post('/api/admin/ai/test', editingId.value ? { id: editingId.value } : {});
    ElMessage.success(`连接正常 · ${r.model} · ${r.ms} ms`);
    await load();
  } catch (e: any) {
    ElMessage.error('连接失败：' + (e?.message || '未知错误'));
  } finally {
    testing.value = false;
  }
}

function fmtNum(n: number): string {
  return (Number(n) || 0).toLocaleString('zh-CN');
}

onMounted(load);
</script>

<template>
  <div class="sp-page" v-loading="loading">
    <div class="sp-page-head">
      <div>
        <h2>AI 模型管理</h2>
        <div class="sub">接一个模型服务，用于卡片信息自动补全</div>
      </div>
      <div class="head-right">
        <span class="ai-state" :class="state.cls"><i></i>{{ state.text }}</span>
        <el-button :icon="Refresh" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- 服务商：改成弹窗，只从模型记录的「新增 / 编辑」打开，保存后自动关闭 -->
    <el-dialog
      v-model="dialogOpen" :title="editingId ? '编辑模型' : '新增模型'"
      width="560px" align-center :close-on-click-modal="false" :append-to-body="true"
    >
      <el-form label-width="104px" label-position="left" class="ai-form">
        <el-form-item label="备注名">
          <el-input v-model="form.name" maxlength="40" placeholder="给这个模型起个好认的名字，例如 DeepSeek·主用" />
          <div v-if="editingId" class="ai-hint">
            正在编辑已有记录 <b>{{ form.name || '（未命名）' }}</b>
          </div>
        </el-form-item>
        <el-form-item label="预设">
          <div class="ai-presets">
            <button
              v-for="p in PRESETS" :key="p.key" type="button"
              class="ai-chip" :class="{ on: preset === p.key }"
              @click="applyPreset(p.key)"
            >{{ p.label }}</button>
          </div>
        </el-form-item>
        <el-form-item v-if="!isBuiltin" label="接口地址">
          <el-input v-model="form.base_url" placeholder="https://api.deepseek.com/v1" />
          <div class="ai-hint">{{ curPreset.tip }}</div>
        </el-form-item>
        <el-form-item v-else label="调用方式">
          <div class="ai-builtin">
            本站账号自带的 Workers AI 额度，<b>不填地址、不填密钥</b>
          </div>
          <div class="ai-hint">{{ curPreset.tip }}</div>
        </el-form-item>
        <el-form-item label="模型名">
          <el-input v-model="form.model" placeholder="deepseek-chat" />
          <div class="ai-hint">填服务商文档里的模型标识，不要填显示名</div>
        </el-form-item>
        <el-form-item v-if="!isBuiltin" label="API 密钥">
          <div class="ai-key">
            <el-input
              v-model="keyInput" type="password" show-password
              :placeholder="dlgConfigured ? '已配置 ' + dlgKeyHint + '（留空表示不修改）' : '粘贴密钥，保存后生效'"
            />
            <el-button v-if="dlgConfigured" text class="ai-clear" @click="clearKey">清除</el-button>
          </div>
          <div class="ai-hint">密钥加密后存数据库，只回末四位；不参与备份导出，也不会出现在页面源码里</div>
        </el-form-item>
        <el-form-item label="启用">
          <div class="ai-switch-row">
            <el-switch v-model="form.switch_on" />
            <span class="ai-switch-tip">{{ dlgConfigured ? '关闭后卡片补全只填网页自带信息' : (isBuiltin ? '这台部署缺少 AI 绑定，先用自定义通道' : '未填密钥时，开关打开也不生效') }}</span>
          </div>
        </el-form-item>
        <el-form-item label="每日上限">
          <el-input-number v-model="form.daily_limit" :min="1" :max="1000" style="width:160px" />
          <span class="ai-hint inline">超出后当天自动停用，防账单失控</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="ai-dlg-foot">
          <el-button :icon="Connection" :loading="testing" @click="testConn">测试连接</el-button>
          <span class="ai-dlg-gap"></span>
          <el-button @click="dialogOpen = false">取消</el-button>
          <el-button type="primary" :icon="MagicStick" :loading="saving" @click="save">保存设置</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 模型记录：新增 / 编辑走上面的弹窗，这里只负责切换 / 测试 / 删除 -->
    <div class="sp-card">
      <div class="sp-card-title ai-rec-head">
        <span>模型记录<span class="ai-rec-count">共 {{ models.length }} 条</span></span>
        <el-button size="small" type="primary" :icon="Plus" @click="newRecord">新增模型</el-button>
      </div>
      <div v-if="!models.length" class="ai-rec-empty">
        还没有记录，点右上角「新增模型」添加第一条
      </div>
      <div v-else class="ai-rec-list">
        <div v-for="m in models" :key="m.id" class="ai-rec" :class="{ on: m.id === activeId }">
          <span class="ai-rec-ico"><IIcon name="ri:magic-line" :size="14" /></span>
          <div class="ai-rec-main">
            <div class="ai-rec-name">
              {{ m.name }}
              <span v-if="m.id === activeId" class="ai-rec-badge">生效中</span>
            </div>
            <div class="ai-rec-sub">
              {{ m.provider === 'cf' ? '内置通道' : (m.base_url || '自定义') }} · {{ m.model }}
            </div>
          </div>
          <div class="ai-rec-ops">
            <button type="button" class="ai-rec-op" title="编辑" aria-label="编辑" @click="editRecord(m)">
              <IIcon name="ri:pencil-line" :size="14" />
            </button>
            <button
              type="button" class="ai-rec-op" :disabled="!!testingId"
              :title="testingId === m.id ? '正在测试…' : '测试连接'" aria-label="测试连接"
              @click="testRecord(m)"
            >
              <span v-if="testingId === m.id" class="ai-op-spin" aria-hidden="true"></span>
              <IIcon v-else name="ri:plug-line" :size="14" />
            </button>
            <button
              type="button" class="ai-rec-op" :class="{ dis: m.id === activeId }"
              :title="m.id === activeId ? '当前已生效' : '切换为当前模型'" aria-label="切换为当前模型"
              :disabled="m.id === activeId || !!testingId" @click="switchRecord(m)"
            >
              <IIcon name="ri:link" :size="14" />
            </button>
            <button type="button" class="ai-rec-op danger" title="删除" aria-label="删除" @click="removeRecord(m)">
              <IIcon name="ri:delete-bin-line" :size="14" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">用量</div>
      <div class="ai-usage">
        <div class="ai-usage-item">
          <span class="ai-usage-lab">今日调用</span>
          <span class="ai-usage-val">{{ fmtNum(info?.usage?.calls || 0) }}<em>/ {{ form.daily_limit }}</em></span>
        </div>
        <div class="ai-usage-item">
          <span class="ai-usage-lab">今日 token</span>
          <span class="ai-usage-val">{{ fmtNum(info?.usage?.tokens || 0) }}</span>
        </div>
        <div class="ai-usage-item">
          <span class="ai-usage-lab">本月调用</span>
          <span class="ai-usage-val">{{ fmtNum(info?.usage?.month_calls || 0) }}</span>
        </div>
        <div class="ai-usage-item">
          <span class="ai-usage-lab">本月 token</span>
          <span class="ai-usage-val">{{ fmtNum(info?.usage?.month_tokens || 0) }}</span>
        </div>
      </div>
      <div class="ai-hint">按北京时间统计；调用失败也计入次数，避免失败请求被无限重试</div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">怎么用</div>
      <ul class="ai-steps">
        <li>打开「分组与卡片」，点任意卡片的编辑（或新建卡片）。</li>
        <li>在「默认地址」里粘贴网址，点输入框右侧的 <b>AI 补全</b>。</li>
        <li>标题、描述、图标、主题色、所属分组会被自动填好，<b>再点保存</b>才会落库。</li>
        <li>网页抓不到信息（需要登录、反爬）时会只填能拿到的部分，并提示原因。</li>
      </ul>
      <div class="ai-note">
        说明：AI 只负责「起名、写一句说明、挑图标、选分组」。网址本身和你的卡片数据不会整站上传，
        每次只发送这一个网址和它公开的标题/描述。
      </div>
      <div class="ai-note">
        选「Cloudflare Workers AI（内置）」时走本站账号自带的额度，不填地址、不填密钥，
        也不产生公网请求 —— 第三方中转站报 <b>error 1015</b>（对云服务器出口限流）时，用这个通道最稳。
      </div>
    </div>
  </div>
</template>

<style scoped>
.ai-builtin { font-size: 13px; color: var(--text-2); line-height: 1.6; }
.ai-builtin b { color: var(--text); }
.head-right { display: flex; align-items: center; gap: 10px; }

.ai-state {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--sp-dim);
  padding: 4px 10px; border-radius: 999px;
  background: var(--sp-ctrl); border: 1px solid var(--sp-border);
}
.ai-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--sp-faint); }
.ai-state.on { color: var(--sp-ok); }
.ai-state.on i { background: var(--sp-ok); box-shadow: 0 0 0 3px rgba(var(--sp-ok-rgb), .15); }

.ai-form { max-width: 720px; }
.ai-form :deep(.el-form-item) { margin-bottom: 16px; }
.ai-form :deep(.el-form-item__label) { color: var(--sp-dim); font-size: 13px; }

.ai-presets { display: flex; flex-wrap: wrap; gap: 8px; }
.ai-chip {
  font: inherit; font-size: 12.5px; cursor: pointer;
  padding: 6px 12px; border-radius: 999px;
  background: var(--sp-ctrl); color: var(--sp-dim);
  border: 1px solid var(--sp-border);
  transition: color .15s, border-color .15s, background .15s;
}
.ai-chip:hover { color: var(--sp-text); border-color: var(--sp-border-strong, var(--sp-border)); }
.ai-chip.on {
  color: var(--sp-accent); border-color: var(--sp-accent);
  background: rgba(var(--sp-accent-rgb), .1);
}

.ai-hint { font-size: 11.5px; color: var(--sp-faint); line-height: 1.5; margin-top: 4px; }
.ai-hint.inline { margin: 0 0 0 10px; }

.ai-key { display: flex; align-items: center; gap: 8px; width: 100%; }
.ai-clear { color: var(--sp-danger, #e24b4a); flex: none; }

/* 模型记录列表：白底 + 分割线的简洁行式，跟分组/卡片列表保持一致 */
.ai-rec-count { margin-left: 8px; font-size: 11.5px; font-weight: 400; color: var(--sp-faint); }
.ai-rec-empty { padding: 14px 2px; font-size: 12.5px; color: var(--sp-faint); line-height: 1.6; }

.ai-rec-list { display: flex; flex-direction: column; }
.ai-rec {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 2px;
  border-top: 1px solid var(--sp-border);
}
.ai-rec:first-child { border-top: none; }
.ai-rec.on { background: rgba(var(--sp-accent-rgb), .06); }

.ai-rec-ico {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  color: var(--sp-accent);
  background: rgba(var(--sp-accent-rgb), .12);
}

.ai-rec-main { flex: 1 1 auto; min-width: 0; }
.ai-rec-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--sp-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ai-rec-badge {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--sp-ok);
  background: rgba(var(--sp-ok-rgb), .12);
}
.ai-rec-sub {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--sp-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-rec-ops { display: flex; align-items: center; gap: 2px; flex: none; }
.ai-rec-op {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font: inherit;
  color: var(--sp-dim);
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: color .15s, background .15s;
}
.ai-rec-op:hover { color: var(--sp-text); background: var(--sp-ctrl); }
.ai-rec-op.danger:hover { color: var(--sp-danger, #e24b4a); background: rgba(var(--sp-danger-rgb, 226, 75, 74), .12); }
.ai-rec-op:disabled { cursor: default; opacity: .3; }
.ai-rec-op.dis:disabled { color: var(--sp-ok); opacity: .55; }

/* 行内「测试」忙碌时的小转圈，沿用主题色变量 */
.ai-op-spin {
  width: 13px;
  height: 13px;
  border: 1.5px solid rgba(var(--sp-accent-rgb), .25);
  border-top-color: var(--sp-accent);
  border-radius: 50%;
  animation: ai-op-rotate .7s linear infinite;
}
@keyframes ai-op-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .ai-op-spin { animation: none; border-top-color: rgba(var(--sp-accent-rgb), .5); }
}

/* 弹窗底部：测试靠左，取消/保存靠右 */
.ai-dlg-foot { display: flex; align-items: center; width: 100%; }
.ai-dlg-gap { flex: 1 1 auto; }

/* 模型记录标题行：标题在左，新增按钮在右 */
.ai-rec-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

.ai-switch-row { display: flex; align-items: center; gap: 10px; }
.ai-switch-tip { font-size: 12px; color: var(--sp-faint); }

.ai-actions { display: flex; align-items: center; gap: 10px; }

.ai-usage { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 10px; }
.ai-usage-item {
  background: var(--sp-ctrl); border: 1px solid var(--sp-border);
  border-radius: 10px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 6px;
}
.ai-usage-lab { font-size: 11.5px; color: var(--sp-faint); }
.ai-usage-val { font-size: 20px; font-weight: 600; color: var(--sp-text); font-variant-numeric: tabular-nums; }
.ai-usage-val em { font-style: normal; font-size: 12px; font-weight: 400; color: var(--sp-faint); margin-left: 4px; }

.ai-steps { margin: 0; padding-left: 18px; color: var(--sp-dim); font-size: 13px; line-height: 1.9; }
.ai-steps b { color: var(--sp-text); font-weight: 600; }
.ai-note {
  margin-top: 12px; padding: 10px 12px; border-radius: 8px;
  background: var(--sp-ctrl); color: var(--sp-faint); font-size: 12px; line-height: 1.7;
}

@media (max-width: 720px) {
  .ai-usage { grid-template-columns: repeat(2, 1fr); }
}
</style>
