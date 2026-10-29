<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue';
import { get, post, put } from '../api';
import { notifyHome } from '../lib/notify';
import { useStore } from '../store';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Link, FolderOpened, User, Lock, Check, Upload, Download } from '@element-plus/icons-vue';

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

/* 导入 / 恢复时可选的模块清单（顺序即展示顺序）。
   items = 分组 + 卡片，两者强绑定，永远一起导入；其余模块各自独立。
   desc 是勾选弹窗里每项的一句说明，让用户清楚这项到底覆盖什么。 */
const MODULES = [
  { key: 'config', label: '配置', desc: '主题、壁纸、搜索引擎等全局设置', mode: 'num', ckey: 'config' },
  { key: 'items', label: '分组与卡片', desc: '分组结构和全部链接、内置组件卡片', mode: 'pair', ckey: 'items', ckey2: 'icons' },
  { key: 'users', label: '用户', desc: '登录账号、密码与角色权限', mode: 'num', ckey: 'users' },
  { key: 'caldays', label: '节假日', desc: '日历组件的节假日与调休安排', mode: 'num', ckey: 'caldays' },
  { key: 'widgetcfgs', label: '组件设置', desc: '备忘录、待办等组件的内容数据', mode: 'num', ckey: 'widgetcfgs' },
  { key: 'backup', label: '备份设置', desc: 'WebDAV / S3 参数（不含密码密钥）', mode: 'flag', ckey: 'backup' },
] as const;

/** 模块在备份里有没有可导入的内容（无内容的模块禁勾并默认不勾） */
function moduleAvailable(counts: Record<string, number>, m: typeof MODULES[number]): boolean {
  if (m.mode === 'pair') return (counts[m.ckey] || 0) + (counts[m.ckey2!] || 0) > 0;
  return (counts[m.ckey] || 0) > 0;
}
/** 模块右侧展示的数量文案 */
function moduleLabel(counts: Record<string, number>, m: typeof MODULES[number]): string {
  if (m.mode === 'num') return `${counts[m.ckey] || 0} 项`;
  if (m.mode === 'pair') return `${counts[m.ckey] || 0} 组 / ${counts[m.ckey2!] || 0} 张`;
  return counts[m.ckey] ? '含配置' : '无';
}
/** 从已解析的本地 JSON 算出各模块数量（云端走后端 dry 返回的 counts，形状一致） */
function countsFromObj(o: any): Record<string, number> {
  return {
    config: Array.isArray(o.config) ? o.config.length : 0,
    items: Array.isArray(o.groups) ? o.groups.length : 0,
    icons: Array.isArray(o.icons) ? o.icons.length : 0,
    users: Array.isArray(o.users) ? o.users.length : 0,
    caldays: Array.isArray(o.calDays) ? o.calDays.length : 0,
    widgetcfgs: Array.isArray(o.widgetCfgs) ? o.widgetCfgs.length : 0,
    backup: o.backup ? Object.keys(o.backup).length : 0,
  };
}
/** 从已解析的本地 JSON 算出各模块的字节大小（与后端 snapshotStats 同口径，
    按 UTF-8 计，即这些数据写进导出文件的实际体积；items = 分组 + 卡片之和） */
function sizesFromObj(o: any): Record<string, number> {
  const enc = new TextEncoder();
  const b = (v: any) => (v === undefined || v === null) ? 0 : enc.encode(JSON.stringify(v)).length;
  return {
    config: b(o.config),
    items: b(o.groups) + b(o.icons),
    users: b(o.users),
    caldays: b(o.calDays),
    widgetcfgs: b(o.widgetCfgs),
    backup: b(o.backup),
  };
}
/** 模块勾选行右侧展示的大小文案（本地导入从 obj 算，云端用 dry 返回的 sizes） */
function moduleSize(sizes: Record<string, number> | undefined, m: typeof MODULES[number]): string {
  const n = sizes?.[m.key] || 0;
  return n ? fmtSize(n) : '';
}
/** 把返回的各模块计数拼成一句可读的导入结果 */
function summarizeImport(c: any): string {
  const parts: string[] = [];
  if (c.groups) parts.push(`${c.groups} 组`);
  if (c.icons) parts.push(`${c.icons} 张`);
  if (c.configs) parts.push(`${c.configs} 项配置`);
  if (c.users) parts.push(`${c.users} 个用户`);
  if (c.caldays) parts.push(`${c.caldays} 个节假日`);
  if (c.widgetcfgs) parts.push(`${c.widgetcfgs} 项组件设置`);
  if (c.backup) parts.push('备份设置');
  return parts.length ? `已导入 ${parts.join(' / ')}，前台已同步` : '未选择任何模块，未导入任何数据';
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
      throw new Error('这不是本系统导出的备份文件（缺少 UDeNav 标识或分组数据）');
    }
    /* 先解析、再让用户勾选要导入哪些模块，而不是直接全量覆盖 */
    im.obj = obj;
    im.counts = countsFromObj(obj);
    im.sizes = sizesFromObj(obj);
    MODULES.forEach((m) => { im.sel[m.key] = moduleAvailable(im.counts, m); });
    im.open = true;
  } catch (err: any) {
    /* 错误提示保留 8 秒：太短的话还没看清就消失了 */
    ElMessage.error({ message: '读取失败：' + (err?.message || '未知错误'), duration: 8000, showClose: true });
  }
  (e.target as HTMLInputElement).value = '';
}

/* ---------------- 本地导入：模块勾选弹窗 ---------------- */
const im = reactive({
  open: false,
  loading: false,
  obj: null as any,
  counts: {} as Record<string, number>,
  sizes: {} as Record<string, number>,
  sel: {} as Record<string, boolean>,
});
const hasSelectedModulesIm = computed(() => MODULES.some((m) => im.sel[m.key]));
function selectAllModulesIm(v: boolean) {
  MODULES.forEach((m) => { if (moduleAvailable(im.counts, m)) im.sel[m.key] = v; });
}
async function confirmImport() {
  const selArr = MODULES.filter((m) => im.sel[m.key]).map((m) => m.key);
  if (!selArr.length) { ElMessage.warning('请至少选择一个模块'); return; }
  im.loading = true;
  try {
    const r = await post<any>('/api/admin/import', { ...im.obj, confirm: 'restore', modules: selArr });
    im.open = false;
    await store.loadAll();
    notifyHome();
    ElMessage.success(summarizeImport(r));
  } catch (e: any) {
    ElMessage.error({ message: '导入失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
  } finally {
    im.loading = false;
  }
}

/* ---------------- 定期备份到 WebDAV ----------------
   配置存在 app_setting 表（不进导出的 JSON，避免备份文件泄露 WebDAV 密码）。
   定时由 Cloudflare Cron 触发：每天 03:00（北京时间）跑一次，开关关着就跳过。 */
const wd = reactive({
  enabled: false, url: '', user: '', pass: '', dir: 'udenav-backup', keep: 7,
  freq: 'daily' as 'hourly' | 'daily' | 'weekly', hour: 3, weekday: 1,
  last_at: 0 as number, last_ok: null as boolean | null, last_msg: '', has_pass: false,
});
const wdLoading = ref(false);
const wdSaving = ref(false);
const wdRunning = ref(false);
const wdTesting = ref(false);

const PRESETS = [
  { label: '坚果云', url: 'https://dav.jianguoyun.com/dav/', tip: '密码填「应用密码」，不是登录密码' },
  { label: '群晖', url: 'https://your-nas:5006/', tip: '路径按实际共享文件夹填' },
  { label: 'Nextcloud', url: 'https://your-cloud/remote.php/dav/files/用户名/', tip: '' },
];

async function loadWd() {
  wdLoading.value = true;
  try {
    const r = await get<any>('/api/admin/backup');
    Object.assign(wd, r.cfg || {});
    wd.pass = '';   // 密码不回显，留空即沿用已保存的
  } finally {
    wdLoading.value = false;
  }
}
/* ---------------- 定期备份到对象存储（S3 兼容） ----------------
   七牛 Kodo / 阿里 OSS / 腾讯 COS / R2 / MinIO 都提供 S3 兼容端点，
   后端用一套 AWS Signature V4 打通（src/routes/s3.ts），这里只负责把参数填对。
   SecretKey 和 WebDAV 密码一样加密存 app_setting，不进导出的 JSON。 */
const s3 = reactive({
  enabled: false, endpoint: '', region: '', bucket: '', ak: '', sk: '', prefix: 'udenav-backup', keep: 7,
  freq: 'daily' as 'hourly' | 'daily' | 'weekly', hour: 3, weekday: 1,
  last_at: 0 as number, last_ok: null as boolean | null, last_msg: '', has_sk: false,
});
const s3Loading = ref(false);
const s3Saving = ref(false);
const s3Running = ref(false);
const s3Testing = ref(false);

/* 只放「端点格式确定」的三家做预设，其余让用户照服务商文档填，避免给错域名 */
const S3_PRESETS = [
  { label: '七牛 Kodo', endpoint: 'https://s3.cn-east-1.qiniucs.com', region: 'cn-east-1', tip: '区域按空间所在机房选，华东-浙江是 cn-east-1' },
  { label: 'Cloudflare R2', endpoint: 'https://<账户ID>.r2.cloudflarestorage.com', region: 'auto', tip: '把 <账户ID> 换成 R2 概览页里的 Account ID' },
  { label: 'MinIO', endpoint: 'http://127.0.0.1:9000', region: 'us-east-1', tip: '自建 MinIO 默认区域是 us-east-1' },
];

/* 预设只填 endpoint + region，桶名/密钥仍要自己填，避免误以为点一下就配好了 */
function applyS3Preset(p: { endpoint: string; region: string }) {
  s3.endpoint = p.endpoint;
  s3.region = p.region;
}

async function loadS3() {  s3Loading.value = true;
  try {
    const r = await get<any>('/api/admin/backup/s3');
    Object.assign(s3, r.cfg || {});
    s3.sk = '';   // 密钥不回显，留空即沿用已保存的
  } finally {
    s3Loading.value = false;
  }
}

async function saveS3() {
  s3Saving.value = true;
  try {
    await put('/api/admin/backup/s3', { ...s3 });
    await loadS3();
    ElMessage.success('对象存储设置已保存');
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'));
  } finally {
    s3Saving.value = false;
  }
}

async function runS3Now() {
  s3Running.value = true;
  try {
    const r = await post<any>('/api/admin/backup/s3/run', { ...s3 });
    ElMessage.success(`${r.message}（${r.file}）` + (r.pruned ? `，清理旧备份 ${r.pruned} 份` : ''));
    await loadS3();
  } catch (e: any) {
    ElMessage.error({ message: '备份失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
    await loadS3();
  } finally {
    s3Running.value = false;
  }
}

async function testS3() {
  s3Testing.value = true;
  try {
    const r = await post<any>('/api/admin/backup/s3/test', {
      endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, ak: s3.ak, sk: s3.sk, prefix: s3.prefix,
    });
    if (r.ok) ElMessage.success(r.message || '连接成功');
    else ElMessage.warning({ message: r.message || '连接失败', duration: 8000, showClose: true });
  } catch (e: any) {
    ElMessage.error({ message: '测试失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
  } finally {
    s3Testing.value = false;
  }
}

const s3FreqText = computed(() => {
  if (!s3.enabled) return '当前未启用，仅手动备份';
  if (s3.freq === 'hourly') return '每小时整点自动执行';
  if (s3.freq === 'weekly') return `每${WEEKDAYS.find((d) => d.v === s3.weekday)?.label} ${hh(s3.hour)} 自动执行`;
  return `每天 ${hh(s3.hour)} 自动执行`;
});

onMounted(() => { loadWd(); loadS3(); });
function applyPreset(p: { url: string }) {
  wd.url = p.url;
}

async function saveWd() {
  wdSaving.value = true;
  try {
    await put('/api/admin/backup', { ...wd });
    await loadWd();
    ElMessage.success('备份设置已保存');
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || '未知错误'));
  } finally {
    wdSaving.value = false;
  }
}

async function runWdNow() {
  wdRunning.value = true;
  try {
    const r = await post<any>('/api/admin/backup', { ...wd });
    ElMessage.success(`${r.message}（${r.file}）` + (r.pruned ? `，清理旧备份 ${r.pruned} 份` : ''));
    await loadWd();
  } catch (e: any) {
    ElMessage.error({ message: '备份失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
    await loadWd();
  } finally {
    wdRunning.value = false;
  }
}

/* 测试连接：不发真实数据、不建目录，只验「地址可达 + 账号密码对不对」，
   密码留空时后端沿用已保存的那份，方便改完其他配置直接测 */
async function testWd() {
  wdTesting.value = true;
  try {
    const r = await post<any>('/api/admin/backup/test', { url: wd.url, user: wd.user, pass: wd.pass, dir: wd.dir });
    if (r.ok) ElMessage.success(r.message || '连接成功');
    else ElMessage.warning({ message: r.message || '连接失败', duration: 8000, showClose: true });
  } catch (e: any) {
    ElMessage.error({ message: '测试失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
  } finally {
    wdTesting.value = false;
  }
}

function fmtTime(ts?: number) {
  if (!ts) return '还没备份过';
  const d = new Date(ts + 8 * 3600 * 1000);   // 面板统一按北京时间显示
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/* 执行策略：Cloudflare 的 cron 是部署期固定的，实际是每小时触发一次，
   具体哪一轮真正备份由这里选的策略决定（后端 dueNow 判断） */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const WEEKDAYS = [
  { v: 1, label: '周一' }, { v: 2, label: '周二' }, { v: 3, label: '周三' }, { v: 4, label: '周四' },
  { v: 5, label: '周五' }, { v: 6, label: '周六' }, { v: 0, label: '周日' },
];
const hh = (h: number) => String(h).padStart(2, '0') + ':00';

const freqText = computed(() => {
  if (!wd.enabled) return '当前未启用，仅手动备份';
  if (wd.freq === 'hourly') return '每小时整点自动执行';
  if (wd.freq === 'weekly') return `每${WEEKDAYS.find((d) => d.v === wd.weekday)?.label} ${hh(wd.hour)} 自动执行`;
  return `每天 ${hh(wd.hour)} 自动执行`;
});

/* ---------------- 从云端恢复 ----------------
   反向操作：把 WebDAV / 对象存储上的一份备份读回来覆盖当前库。
   两步：先选文件 → 干跑拿到各模块数量 → 勾选要恢复的模块 → 二次确认再写库。
   恢复会 DELETE 选中模块的现有数据，没有撤销。 */
const store = useStore();
const rv = reactive({
  open: false,
  loading: false,
  running: false,
  /* 两份备份共用这个恢复弹窗：dav = WebDAV，s3 = 对象存储，只差接口前缀 */
  src: 'dav' as 'dav' | 's3',
  dir: '',
  pick: '',
  phase: 'pick' as 'pick' | 'modules',
  exportedAt: 0,
  counts: {} as Record<string, number>,
  sizes: {} as Record<string, number>,
  sel: {} as Record<string, boolean>,
  files: [] as Array<{ name: string; size: number; mtime: number }>,
});

const rvApi = () => (rv.src === 's3' ? '/api/admin/backup/s3' : '/api/admin/backup');

function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

const hasSelectedModules = computed(() => MODULES.some((m) => rv.sel[m.key]));
function selectAllModules(v: boolean) {
  MODULES.forEach((m) => { if (moduleAvailable(rv.counts, m)) rv.sel[m.key] = v; });
}

async function openRestore(src: 'dav' | 's3' = 'dav') {
  rv.src = src;
  rv.open = true;
  rv.loading = true;
  rv.phase = 'pick';
  rv.files = [];
  rv.pick = '';
  rv.counts = {};
  rv.sizes = {};
  rv.sel = {};
  try {
    const r = await get<any>(`${rvApi()}/list`);
    rv.dir = r.dir || '';
    rv.files = r.files || [];
    /* 后端已按文件名倒序（字典序即时间序），第一条就是最新 */
    rv.pick = rv.files[0]?.name || '';
  } catch (e: any) {
    ElMessage.error({ message: '读取云端备份失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
    rv.open = false;
  } finally {
    rv.loading = false;
  }
}

/* 第一步确认后：干跑一次，只下载解析、不写库，拿到各模块数量供勾选 */
async function prepareRestore() {
  if (!rv.pick) return;
  rv.loading = true;
  try {
    const p = await post<any>(`${rvApi()}/restore`, { file: rv.pick, dry: true });
    rv.counts = p.counts || {};
    rv.sizes = p.sizes || {};
    rv.exportedAt = Number(p.exported_at) || 0;
    MODULES.forEach((m) => { rv.sel[m.key] = moduleAvailable(rv.counts, m); });
    rv.phase = 'modules';
  } catch (e: any) {
    ElMessage.error({ message: '读取备份内容失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
  } finally {
    rv.loading = false;
  }
}

/* 第二步：二次确认后真正写库，只恢复勾选的模块 */
async function confirmRestore() {
  const selArr = MODULES.filter((m) => rv.sel[m.key]).map((m) => m.key);
  if (!selArr.length) { ElMessage.warning('请至少选择一个模块'); return; }
  try {
    await ElMessageBox.confirm(
      `<div style="line-height:1.9">将用 <b>${rv.pick}</b> 覆盖当前选中的模块。</div>` +
      `<div style="line-height:1.9">备份时间：${fmtTime(rv.exportedAt)}<br>` +
      `将恢复：${selArr.map((k) => MODULES.find((m) => m.key === k)?.label).join('、')}</div>` +
      `<div style="line-height:1.9;color:#e6a23c;margin-top:6px">这些模块当前的数据会被清空后替换，操作不可撤销。</div>`,
      '确认恢复备份',
      { type: 'warning', confirmButtonText: '覆盖并恢复', cancelButtonText: '取消', dangerouslyUseHTMLString: true }
    );
  } catch {
    return;   // 用户点了取消
  }
  rv.running = true;
  try {
    const r = await post<any>(`${rvApi()}/restore`, { file: rv.pick, modules: selArr });
    rv.open = false;
    await store.loadAll();
    notifyHome();
    ElMessage.success(summarizeImport(r));
  } catch (e: any) {
    ElMessage.error({ message: '恢复失败：' + (e?.message || '未知错误'), duration: 8000, showClose: true });
  } finally {
    rv.running = false;
  }
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
        <el-button type="primary" @click="exportAll">导出全部数据（JSON）</el-button>
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

    <!-- 定期备份到 WebDAV -->
    <div class="sp-card" v-loading="wdLoading">
      <div class="sp-card-title">
        定期备份（WebDAV）
        <el-switch v-model="wd.enabled" style="margin-left:10px" />
      </div>

      <!-- 关闭 WebDAV 时整块收起：连接信息、执行计划、操作按钮都不该占版面，
           开关本身就是唯一入口，打开才展开配置 -->
      <el-form v-if="wd.enabled" label-position="top" class="wd-form">
        <div class="wd-sec-label">连接信息</div>

        <el-row :gutter="14">
          <el-col :span="16">
            <el-form-item label="WebDAV 地址">
              <el-input v-model="wd.url" placeholder="https://dav.jianguoyun.com/dav/">
                <template #prefix><el-icon><Link /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="备份目录">
              <el-input v-model="wd.dir" placeholder="udenav-backup">
                <template #prefix><el-icon><FolderOpened /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 常用服务做成可点的胶囊：原来是一排文字链接，看着像说明而不像能点 -->
        <div class="wd-presets">
          <span class="wd-presets-lab">常用</span>
          <button v-for="p in PRESETS" :key="p.label" type="button" class="wd-chip" @click="applyPreset(p)">{{ p.label }}</button>
          <span class="wd-presets-tip">坚果云请用「应用密码」</span>
        </div>

        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="账号">
              <el-input v-model="wd.user" placeholder="登录邮箱 / 用户名" autocomplete="off">
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="wd.has_pass ? '密码（留空则不修改）' : '密码'">
              <el-input v-model="wd.pass" type="password" show-password autocomplete="new-password"
                        :placeholder="wd.has_pass ? '已保存，留空不改' : '应用密码'">
                <template #prefix><el-icon><Lock /></el-icon></template>
                <!-- 测试连接：填完账号就能先验一遍再保存，密码留空时后端自动沿用已存的 -->
                <template #append>
                  <el-button :loading="wdTesting" @click="testWd">测试连接</el-button>
                </template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="wd-sec-label with-line">执行计划</div>

        <el-row :gutter="14">
          <el-col :span="7">
            <el-form-item label="执行策略">
              <el-select v-model="wd.freq" style="width:100%">
                <el-option value="hourly" label="每小时" />
                <el-option value="daily" label="每天" />
                <el-option value="weekly" label="每周" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <!-- 每周时并排显示「星期 + 时间」，其余只显示时间 -->
            <el-form-item :label="wd.freq === 'weekly' ? '星期与时间' : '时间'">
              <div style="display:flex;gap:8px;width:100%">
                <el-select v-if="wd.freq === 'weekly'" v-model="wd.weekday" style="flex:1">
                  <el-option v-for="d in WEEKDAYS" :key="d.v" :value="d.v" :label="d.label" />
                </el-select>
                <el-select v-model="wd.hour" style="flex:1" :disabled="wd.freq === 'hourly'">
                  <el-option v-for="h in HOURS" :key="h" :value="h" :label="hh(h)" />
                </el-select>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="7">
            <el-form-item label="保留份数">
              <el-input-number v-model="wd.keep" :min="1" :max="60" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="wd-actions">
          <el-button type="primary" :loading="wdSaving" @click="saveWd"><el-icon><Check /></el-icon>保存设置</el-button>
          <el-button :loading="wdRunning" @click="runWdNow"><el-icon><Upload /></el-icon>立即备份</el-button>
          <el-button @click="openRestore('dav')"><el-icon><Download /></el-icon>从云端恢复</el-button>
          <!-- 用状态点替掉原来那句灰字，启用与否一眼能看出来 -->
          <span class="wd-state" :class="{ on: wd.enabled }"><i></i>{{ freqText }}</span>
        </div>
      </el-form>

      <el-alert
        v-if="wd.enabled"
        style="margin-top:16px"
        :type="wd.last_ok === false ? 'error' : wd.last_ok ? 'success' : 'info'"
        :closable="false" show-icon
      >
        <template #title>
          上次备份：{{ fmtTime(wd.last_at) }}<span v-if="wd.last_msg"> · {{ wd.last_msg }}</span>
        </template>
      </el-alert>
    </div>

    <!-- 定期备份到对象存储（S3 兼容：七牛 Kodo / R2 / MinIO / OSS / COS） -->
    <div class="sp-card s3-card" v-loading="s3Loading">
      <div class="sp-card-title">
        定期备份（对象存储）
        <el-switch v-model="s3.enabled" style="margin-left:10px" />
      </div>

      <el-form v-if="s3.enabled" label-position="top" class="wd-form">
        <div class="wd-sec-label">连接信息</div>

        <el-row :gutter="14">
          <el-col :span="16">
            <el-form-item label="Endpoint（填到域名，不带桶名）">
              <el-input v-model="s3.endpoint" placeholder="https://s3.cn-east-1.qiniucs.com">
                <template #prefix><el-icon><Link /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="Region">
              <el-input v-model="s3.region" placeholder="cn-east-1" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="wd-presets">
          <span class="wd-presets-lab">常用</span>
          <button v-for="p in S3_PRESETS" :key="p.label" type="button" class="wd-chip"
                  :title="p.tip" @click="applyS3Preset(p)">{{ p.label }}</button>
          <span class="wd-presets-tip">七牛要用 S3 兼容域名，不是空间绑定的下载域名</span>
        </div>

        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="桶名 / 空间名">
              <el-input v-model="s3.bucket" placeholder="my-udenav-backup" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="目录前缀">
              <el-input v-model="s3.prefix" placeholder="udenav-backup">
                <template #prefix><el-icon><FolderOpened /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="14">
          <el-col :span="12">
            <el-form-item label="AccessKey">
              <el-input v-model="s3.ak" placeholder="AK" autocomplete="off">
                <template #prefix><el-icon><User /></el-icon></template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item :label="s3.has_sk ? 'SecretKey（留空则不修改）' : 'SecretKey'">
              <el-input v-model="s3.sk" type="password" show-password autocomplete="new-password"
                        :placeholder="s3.has_sk ? '已保存，留空不改' : 'SK'">
                <template #prefix><el-icon><Lock /></el-icon></template>
                <template #append>
                  <el-button :loading="s3Testing" @click="testS3">测试连接</el-button>
                </template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <div class="wd-sec-label with-line">执行计划</div>

        <el-row :gutter="14">
          <el-col :span="7">
            <el-form-item label="执行策略">
              <el-select v-model="s3.freq" style="width:100%">
                <el-option value="hourly" label="每小时" />
                <el-option value="daily" label="每天" />
                <el-option value="weekly" label="每周" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item :label="s3.freq === 'weekly' ? '星期与时间' : '时间'">
              <div style="display:flex;gap:8px;width:100%">
                <el-select v-if="s3.freq === 'weekly'" v-model="s3.weekday" style="flex:1">
                  <el-option v-for="d in WEEKDAYS" :key="d.v" :value="d.v" :label="d.label" />
                </el-select>
                <el-select v-model="s3.hour" style="flex:1" :disabled="s3.freq === 'hourly'">
                  <el-option v-for="h in HOURS" :key="h" :value="h" :label="hh(h)" />
                </el-select>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="7">
            <el-form-item label="保留份数">
              <el-input-number v-model="s3.keep" :min="1" :max="60" style="width:100%" />
            </el-form-item>
          </el-col>
        </el-row>

        <div class="wd-actions">
          <el-button type="primary" :loading="s3Saving" @click="saveS3"><el-icon><Check /></el-icon>保存设置</el-button>
          <el-button :loading="s3Running" @click="runS3Now"><el-icon><Upload /></el-icon>立即备份</el-button>
          <el-button @click="openRestore('s3')"><el-icon><Download /></el-icon>从桶里恢复</el-button>
          <span class="wd-state" :class="{ on: s3.enabled }"><i></i>{{ s3FreqText }}</span>
        </div>
      </el-form>

      <el-alert
        v-if="s3.enabled"
        style="margin-top:16px"
        :type="s3.last_ok === false ? 'error' : s3.last_ok ? 'success' : 'info'"
        :closable="false" show-icon
      >
        <template #title>
          上次备份：{{ fmtTime(s3.last_at) }}<span v-if="s3.last_msg"> · {{ s3.last_msg }}</span>
        </template>
      </el-alert>
    </div>

    <!-- 从云端恢复：默认选中最新一版，也可以往回收历史版本 -->
    <el-dialog v-model="rv.open" :title="rv.src === 's3' ? '从对象存储恢复' : '从云端恢复'" width="560px" append-to-body>
      <div v-loading="rv.loading" class="rv-body">
        <!-- 第一步：选文件 -->
        <template v-if="rv.phase === 'pick'">
          <div class="rv-tip">
            <template v-if="rv.src === 's3'">桶内目录</template><template v-else>备份目录</template>
            <code>{{ rv.dir || (rv.src === 's3' ? s3.prefix : wd.dir) }}</code> 下共 <b>{{ rv.files.length }}</b> 份，
            已默认选中最新的一版。
          </div>
          <div v-if="!rv.loading && !rv.files.length" class="rv-empty">云端还没有备份文件，先点「立即备份」</div>
          <div class="rv-list">
            <label v-for="(f, i) in rv.files" :key="f.name" class="rv-row" :class="{ on: rv.pick === f.name }">
              <input v-model="rv.pick" type="radio" :value="f.name" />
              <span class="rv-name">{{ f.name }}</span>
              <span v-if="i === 0" class="rv-new">最新</span>
              <span class="rv-meta">{{ f.mtime ? fmtTime(f.mtime) : '' }}{{ f.size ? ' · ' + fmtSize(f.size) : '' }}</span>
            </label>
          </div>
        </template>
        <!-- 第二步：勾选要恢复的模块 -->
        <template v-else>
          <div class="rv-tip">
            备份时间 <b>{{ fmtTime(rv.exportedAt) }}</b>，请勾选要恢复的模块（未勾选的模块保留当前数据不变）：
          </div>
          <div class="rv-mods">
            <label v-for="m in MODULES" :key="m.key" class="rv-mod" :class="{ on: rv.sel[m.key], off: !moduleAvailable(rv.counts, m) }">
              <input type="checkbox" v-model="rv.sel[m.key]" :disabled="!moduleAvailable(rv.counts, m)" />
              <span class="rv-mod-main">
                <span class="rv-mod-label">{{ m.label }}</span>
                <span class="rv-mod-desc">{{ m.desc }}</span>
              </span>
              <span class="rv-mod-side">
                <span class="rv-mod-count">{{ moduleLabel(rv.counts, m) }}</span>
                <span class="rv-mod-size">{{ moduleSize(rv.sizes, m) }}</span>
              </span>
            </label>
          </div>
          <div class="rv-mods-actions">
            <el-button size="small" text @click="rv.phase = 'pick'; rv.pick = ''">重选文件</el-button>
            <span class="rv-spacer" />
            <el-button size="small" @click="selectAllModules(true)">全选</el-button>
            <el-button size="small" @click="selectAllModules(false)">全不选</el-button>
          </div>
        </template>
      </div>
      <template #footer>
        <el-button @click="rv.open = false">取消</el-button>
        <el-button v-if="rv.phase === 'pick'" type="primary" :loading="rv.running" :disabled="!rv.pick" @click="prepareRestore">下一步：选择恢复内容</el-button>
        <el-button v-else type="danger" :loading="rv.running" :disabled="!hasSelectedModules" @click="confirmRestore">恢复选中内容</el-button>
      </template>
    </el-dialog>

    <!-- 本地导入：勾选要导入的模块 -->
    <el-dialog v-model="im.open" title="选择要导入的内容" width="560px" append-to-body>
      <div v-loading="im.loading" class="rv-body">
        <div class="rv-tip">备份文件中包含以下模块，请勾选要导入的项（未勾选的模块保留当前数据不变）：</div>
        <div class="rv-mods">
          <label v-for="m in MODULES" :key="m.key" class="rv-mod" :class="{ on: im.sel[m.key], off: !moduleAvailable(im.counts, m) }">
            <input type="checkbox" v-model="im.sel[m.key]" :disabled="!moduleAvailable(im.counts, m)" />
            <span class="rv-mod-main">
              <span class="rv-mod-label">{{ m.label }}</span>
              <span class="rv-mod-desc">{{ m.desc }}</span>
            </span>
            <span class="rv-mod-side">
              <span class="rv-mod-count">{{ moduleLabel(im.counts, m) }}</span>
              <span class="rv-mod-size">{{ moduleSize(im.sizes, m) }}</span>
            </span>
          </label>
        </div>
        <div class="rv-mods-actions">
          <span class="rv-spacer" />
          <el-button size="small" @click="selectAllModulesIm(true)">全选</el-button>
          <el-button size="small" @click="selectAllModulesIm(false)">全不选</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="im.open = false">取消</el-button>
        <el-button type="primary" :loading="im.loading" :disabled="!hasSelectedModulesIm" @click="confirmImport">确认导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
  .rv-body { min-height: 110px; }
  .rv-tip { font-size: 12.5px; color: var(--sp-dim); margin-bottom: 10px; }
  .rv-tip code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; background: var(--sp-chip-bg); padding: 1px 5px; border-radius: 4px;
  }
  .rv-empty { font-size: 13px; color: var(--sp-dim); padding: 28px 0; text-align: center; }
  .rv-list { max-height: 322px; overflow: auto; display: flex; flex-direction: column; gap: 6px; padding-right: 4px; }

  /* ---- 模块勾选清单（本地导入 / 云端恢复共用）---- */
  .rv-mods { display: flex; flex-direction: column; gap: 6px; }
  .rv-mod {
    display: flex; align-items: center; gap: 10px;
    padding: 10px 12px; border: 1px solid var(--sp-card-border); border-radius: 9px;
    cursor: pointer; transition: background .15s, border-color .15s;
  }
  .rv-mod:hover { background: var(--sp-hover); }
  .rv-mod.on { border-color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .08); }
  .rv-mod.off { opacity: .5; cursor: not-allowed; }
  .rv-mod input { flex: none; margin: 0; accent-color: var(--sp-accent); cursor: pointer; }
  .rv-mod.off input { cursor: not-allowed; }
  /* 中列：名称 + 一句说明 */
  .rv-mod-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .rv-mod-label { font-size: 13px; color: var(--sp-text); line-height: 1.35; }
  .rv-mod-desc { font-size: 11.5px; color: var(--sp-dim); line-height: 1.35; }
  .rv-mod.off .rv-mod-desc { opacity: .75; }
  /* 右列：数量 + 占用大小，右对齐 */
  .rv-mod-side { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
  .rv-mod-count { font-size: 11.5px; color: var(--sp-dim); font-variant-numeric: tabular-nums; }
  .rv-mod-size { font-size: 11px; color: var(--sp-faint, var(--sp-dim)); font-variant-numeric: tabular-nums; min-height: 13px; }
  .rv-mods-actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
  .rv-spacer { flex: 1; }
  .rv-row {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 11px; border: 1px solid var(--sp-card-border); border-radius: 9px;
    cursor: pointer; transition: background .15s, border-color .15s;
  }
  .rv-row:hover { background: var(--sp-hover); }
  /* 选中行：和「立即备份」同一套绿色，一眼知道恢复的是哪一份 */
  .rv-row.on { border-color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .08); }
  .rv-row input { flex: none; margin: 0; accent-color: var(--sp-accent); cursor: pointer; }
  .rv-name {
    flex: 1; min-width: 0; font-size: 12.5px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rv-new {
    flex: none; font-size: 10px; font-weight: 600; line-height: 1;
    padding: 3px 6px; border-radius: 20px;
    color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .12);
    border: 1px solid rgba(var(--sp-accent-rgb), .28);
  }
  .rv-meta { flex: none; font-size: 11.5px; color: var(--sp-dim); font-variant-numeric: tabular-nums; }

  /* ---- 定期备份表单 ---- */
  .wd-form { max-width: 720px; }
  /* label-position=top 时 Element 自带 8px 下边距，这里收紧到 5px，
     否则标签和控件之间空得能塞下一行字 */
  .wd-form :deep(.el-form-item) { margin-bottom: 14px; }
  .wd-form :deep(.el-form-item__label) {
    margin-bottom: 5px; padding-bottom: 0;
    font-size: 12.5px; line-height: 1.3; color: var(--sp-dim);
  }
  /* 两段之间用一条细线分层，比单纯拉大间距更像「一组设置」 */
  .wd-sec-label {
    font-size: 11.5px; font-weight: 700; letter-spacing: .8px;
    color: var(--sp-dim); margin: 0 0 10px;
  }
  .wd-sec-label.with-line {
    margin-top: 2px; padding-top: 14px;
    border-top: 1px solid var(--sp-border);
  }

  .wd-presets {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    margin: -6px 0 14px;
  }
  .wd-presets-lab { font-size: 12px; color: var(--sp-faint); }
  .wd-chip {
    border: 1px solid var(--sp-border); background: var(--sp-card-in);
    color: var(--sp-dim); font: inherit; font-size: 12px; line-height: 1;
    padding: 5px 9px; border-radius: 999px; cursor: pointer;
    transition: border-color .15s, color .15s, background .15s;
  }
  .wd-chip:hover {
    border-color: rgba(var(--sp-accent-rgb), .55);
    color: var(--sp-accent); background: var(--sp-accent-soft);
  }
  .wd-presets-tip {
    font-size: 11.5px; color: var(--sp-faint);
    margin-left: 2px; padding-left: 9px;
    border-left: 1px solid var(--sp-border);
  }

  .wd-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .wd-actions :deep(.el-icon) { margin-right: 5px; }
  /* 状态点：启用为绿，未启用为灰，比一行说明文字好扫 */
  .wd-state {
    display: inline-flex; align-items: center; gap: 6px;
    margin-left: auto; font-size: 12px; color: var(--sp-faint);
  }
  .wd-state i { width: 6px; height: 6px; border-radius: 50%; background: var(--sp-faint); }
  .wd-state.on { color: var(--sp-ok); }
  .wd-state.on i { background: var(--sp-ok); box-shadow: 0 0 0 3px rgba(var(--sp-ok-rgb), .15); }

  @media (max-width: 860px) {
    .wd-state { margin-left: 0; }
  }
</style>
