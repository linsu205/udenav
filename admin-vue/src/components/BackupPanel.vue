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
    const r = await post<any>('/api/admin/import', { ...obj, confirm: 'restore' });
    ElMessage.success(`已导入 ${r.groups} 组 / ${r.icons} 张卡片，前台已同步`);
    notifyHome();
  } catch (err: any) {
    /* 错误提示保留 8 秒：太短的话还没看清就消失了 */
    ElMessage.error({ message: '导入失败：' + (err?.message || '未知错误'), duration: 8000, showClose: true });
  }
  (e.target as HTMLInputElement).value = '';
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
onMounted(loadWd);

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
   反向操作：把 WebDAV 上的一份备份读回来覆盖当前库。
   面板打开时先 dry run，让用户看清这份备份里到底有多少组/多少卡片再决定覆盖 ——
   恢复会 DELETE 现有的分组、卡片、配置，没有撤销。 */
const store = useStore();
const rv = reactive({
  open: false,
  loading: false,
  running: false,
  dir: '',
  pick: '',
  files: [] as Array<{ name: string; size: number; mtime: number }>,
});

function fmtSize(n: number): string {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function openRestore() {
  rv.open = true;
  rv.loading = true;
  rv.files = [];
  rv.pick = '';
  try {
    const r = await get<any>('/api/admin/backup/list');
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

async function doRestore() {
  if (!rv.pick) return;
  rv.running = true;
  try {
    /* 先干跑一次：只下载并解析，不写库，拿这份备份的真实内容去问用户 */
    const p = await post<any>('/api/admin/backup/restore', { file: rv.pick, dry: true });
    try {
      await ElMessageBox.confirm(
        `<div style="line-height:1.9">将用 <b>${p.file}</b> 覆盖当前数据。</div>` +
        `<div style="line-height:1.9">备份时间：${fmtTime(p.exported_at)}<br>` +
        `内容：${p.groups} 个分组 / ${p.icons} 张卡片 / ${p.configs} 项配置</div>` +
        `<div style="line-height:1.9;color:#e6a23c;margin-top:6px">当前的分组、卡片和配置会被清空后替换，操作不可撤销。</div>`,
        '确认恢复备份',
        { type: 'warning', confirmButtonText: '覆盖并恢复', cancelButtonText: '取消', dangerouslyUseHTMLString: true }
      );
    } catch {
      rv.running = false;
      return;   // 用户点了取消
    }

    const r = await post<any>('/api/admin/backup/restore', { file: rv.pick });
    rv.open = false;
    await store.loadAll();
    notifyHome();
    ElMessage.success(`已恢复 ${r.groups} 组 / ${r.icons} 张卡片，前台已同步`);
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
          <el-button @click="openRestore"><el-icon><Download /></el-icon>从云端恢复</el-button>
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

    <!-- 从云端恢复：默认选中最新一版，也可以往回收历史版本 -->
    <el-dialog v-model="rv.open" title="从云端恢复" width="540px" append-to-body>
      <div v-loading="rv.loading" class="rv-body">
        <div class="rv-tip">
          备份目录 <code>{{ rv.dir || wd.dir }}</code> 下共 <b>{{ rv.files.length }}</b> 份，
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
      </div>
      <template #footer>
        <el-button @click="rv.open = false">取消</el-button>
        <el-button type="danger" :loading="rv.running" :disabled="!rv.pick" @click="doRestore">恢复这一版</el-button>
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
