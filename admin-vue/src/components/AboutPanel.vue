<script setup lang="ts">
/**
 * 「关于」页：版本信息 / 项目情况 / 检查更新
 *
 * 数据来源分三处，刻意不合并：
 *   1. /api/admin/about        —— Worker 侧的真实运行情况（版本、功能开关、备份状态、数据量）
 *   2. import.meta.url          —— 当前页面实际在跑哪个 bundle（构建产物带哈希，最可信）
 *   3. /api/admin/about/check   —— 上游 GitHub 最新发布 / 提交（后端代查，避免 CORS 与限流细节外泄）
 *
 * 「检查更新」要回答两个不同的问题，所以是两行独立结果：
 *   · 线上已部署的是不是比我现在这份新？（本地前端的 bundle 名 vs /admin 引用的 bundle 名）
 *   · 上游仓库有没有新代码/新版本？（GitHub）
 * 混成一句「已是最新版」会误导：页面可能跑旧包，而旧包正好也是上游最新。
 */
import { ref, computed, onMounted } from 'vue';
import { get } from '../api';
import { useStore } from '../store';
import { logoSrc } from '../lib/brand';
import { ElMessage } from 'element-plus';
import {
  Refresh, Link, ArrowRight, CircleCheckFilled, WarningFilled, CircleCloseFilled,
  QuestionFilled, Monitor, DataLine, Clock, Connection, Box, Sunny, MagicStick, TopRight,
} from '@element-plus/icons-vue';

/* vite.config.ts 的 define 注入，构建时写死，用来判断「这份包是什么时候打的」 */
const BUILD_AT = typeof __ADMIN_BUILD__ === 'string' ? __ADMIN_BUILD__ : '';

const store = useStore();

/* 身份卡上的图标：有自定义 favicon 就用它，否则用项目 logo（U + 箭头）。
   不再写死一个「u」字母块 —— 那不是这个项目的标识 */
const heroLogo = computed(() => logoSrc(store.config?.favicon));

const info = ref<any>({});
const loading = ref(false);
const checking = ref(false);
const rows = ref<CheckRow[]>([]);
const lastCheck = ref('');
const ghNote = ref('');

type State = 'ok' | 'warn' | 'err' | 'idle';
interface CheckRow {
  key: string; label: string; state: State;
  title: string; detail: string; url?: string;
}

/* ---------------- 时间格式化 ---------------- */
function fmtTime(v?: string | number | null): string {
  if (!v) return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function relTime(v?: string | number | null): string {
  if (!v) return '';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 0) return '刚刚';
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return m + ' 分钟前';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' 小时前';
  const d = Math.floor(h / 24);
  if (d < 30) return d + ' 天前';
  return Math.floor(d / 30) + ' 个月前';
}

/* ---------------- 主体数据 ---------------- */
async function load() {
  loading.value = true;
  try {
    info.value = await get('/api/admin/about');
  } catch (e: any) {
    ElMessage.error('读取版本信息失败：' + (e?.message || '未知错误'));
  } finally {
    loading.value = false;
  }
}

/* ---------------- 检查更新 ---------------- */

/** 从 URL 里取文件名：/admin-assets/admin.a1b2c3.js → admin.a1b2c3.js */
function bundleName(u: string): string {
  try {
    const p = new URL(u, location.href).pathname;
    return p.split('/').pop() || '';
  } catch {
    return '';
  }
}
/** admin.a1b2c3d4.js → a1b2c3d4（只显示哈希，够区分就行） */
function shortHash(name: string): string {
  const m = name.match(/\.([\w-]{6,})\.js$/);
  return m ? m[1] : name;
}

/** 当前页面跑的 bundle（import.meta.url 在构建后就是自己的真实地址） */
const curBundle = bundleName(import.meta.url);

/** 线上 /admin 现在引用的 bundle（不缓存，才看得到刚部署的新包） */
async function liveBundle(): Promise<{ name: string; error?: string }> {
  try {
    const res = await fetch('/admin?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { name: '', error: 'HTTP ' + res.status };
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const src = doc.querySelector('script[type="module"]')?.getAttribute('src') || '';
    return { name: bundleName(src) };
  } catch (e: any) {
    return { name: '', error: e?.message || '网络请求失败' };
  }
}

function deployRow(cur: string, live: { name: string; error?: string }): CheckRow {
  const base = { key: 'deploy', label: '部署一致性' };
  if (live.error) {
    return { ...base, state: 'err', title: '读不到线上版本', detail: '请求 /admin 失败：' + live.error };
  }
  if (!live.name) {
    return { ...base, state: 'warn', title: '线上入口脚本解析失败', detail: '/admin 返回的 HTML 里没有 module 脚本，可能被代理改写了' };
  }
  if (live.name === cur) {
    return { ...base, state: 'ok', title: '与线上部署一致', detail: `当前运行 ${cur}` };
  }
  return {
    ...base, state: 'warn', title: '当前页面跑的是旧包',
    detail: `线上已更新为 ${shortHash(live.name)}，按 F5 刷新即可加载新版本`,
  };
}

function repoRow(gh: any): CheckRow {
  const base = { key: 'repo', label: '上游仓库' };
  if (!gh || gh.ok !== true) {
    return {
      ...base, state: 'idle', title: '暂时查不到上游信息',
      detail: (gh && gh.error) || '请稍后重试',
      url: info.value.app?.repo,
    };
  }
  const local = String(info.value.app?.version || '');
  if (gh.kind === 'release') {
    const lv = String(gh.version || '').replace(/^v/i, '');
    const same = !lv || !local || lv === local;
    return {
      ...base,
      state: same ? 'ok' : 'warn',
      title: same ? `已是最新发布 ${gh.version}` : `上游发布 ${gh.version}，当前 ${local}`,
      detail: [gh.name, fmtTime(gh.date)].filter(Boolean).join(' · '),
      url: gh.url,
    };
  }
  /* 只有提交、没打 tag：拿提交时间和这份包的构建时间比 ——
     早于构建时间说明大概率已经包含；晚于构建时间就一定落后 */
  const cAt = new Date(gh.date).getTime();
  const bAt = BUILD_AT ? new Date(BUILD_AT).getTime() : 0;
  const older = !!(cAt && bAt && cAt > bAt);
  return {
    ...base,
    state: older ? 'warn' : 'ok',
    title: older ? '上游有新提交' : '未发现更新',
    detail: [gh.sha, fmtTime(gh.date), clip(gh.name, 48)].filter(Boolean).join(' · '),
    url: gh.url,
  };
}

function clip(s: string, n: number): string {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function schemaRow(): CheckRow {
  const code = info.value.schema?.code || '';
  const db = info.value.schema?.db || '';
  const ok = !!info.value.schema?.matched;
  return {
    key: 'schema', label: '数据模型',
    state: ok ? 'ok' : 'warn',
    title: ok ? `代码与数据库一致（${code}）` : `代码 ${code || '?'} / 数据库 ${db || '未知'}`,
    detail: ok ? '表结构已是最新，无需迁移' : '迁移可能没跑完：重新访问一次任意接口会自动补齐',
  };
}

async function doCheck(manual = true) {
  if (checking.value) return;
  checking.value = true;
  ghNote.value = '';
  try {
    const [live, gh] = await Promise.all([
      liveBundle(),
      get<any>('/api/admin/about/check').catch((e: any) => ({ ok: false, error: e?.message || '检查失败' })),
    ]);
    rows.value = [deployRow(curBundle, live), repoRow(gh), schemaRow()];
    lastCheck.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (gh?.cached) ghNote.value = '上游结果来自 10 分钟内的缓存';
    if (manual) {
      const bad = rows.value.filter(r => r.state === 'err' || r.state === 'warn');
      if (!bad.length) ElMessage.success('已是最新，无需更新');
      else ElMessage.warning(bad.length + ' 项需要留意');
    }
  } finally {
    checking.value = false;
  }
}

onMounted(async () => {
  await load();
  /* 进页面先静默查一次：部署一致性是本站请求、上游有 10 分钟缓存，成本可以忽略；
     失败不弹提示，只在结果行里说明 */
  doCheck(false);
});

const stateIcon = (s: State) =>
  s === 'ok' ? CircleCheckFilled : s === 'warn' ? WarningFilled : s === 'err' ? CircleCloseFilled : QuestionFilled;

const features = computed(() => info.value.runtime?.features || {});
const backup = computed(() => info.value.backup || {});
const data = computed(() => info.value.data || {});
</script>

<template>
  <div class="sp-page" v-loading="loading">
    <div class="sp-page-head">
      <div>
        <h2>关于</h2>
        <div class="sub">版本信息 · 项目情况 · 检查更新</div>
      </div>
      <div class="head-right">
        <span v-if="lastCheck" class="checked">检查于 {{ lastCheck }}</span>
        <el-button type="primary" :icon="Refresh" :loading="checking" @click="doCheck(true)">检查更新</el-button>
      </div>
    </div>

    <!-- 顶部身份卡 -->
    <div class="hero">
      <div class="hero-logo">
        <img :src="heroLogo" alt="" />
      </div>
      <div class="hero-main">
        <div class="hero-title">
          {{ info.app?.name || 'UDeNav' }}
          <span class="ver">v{{ info.app?.version || '—' }}</span>
          <span class="tag" v-if="info.schema?.matched">数据模型 {{ info.schema?.db }}</span>
        </div>
        <div class="hero-desc">
          轻量导航页 · Cloudflare Workers + D1 + 静态资源，免费额度即可跑；前台单文件、后台分模块构建。
        </div>
        <div class="hero-links">
          <a class="lk" :href="info.app?.repo" target="_blank" rel="noopener">
            <el-icon><Link /></el-icon>GitHub 仓库
          </a>
          <a class="lk" :href="(info.app?.repo || '') + '#readme'" target="_blank" rel="noopener">
            <el-icon><Box /></el-icon>部署与使用说明
          </a>
        </div>
      </div>
    </div>

    <!-- 版本 -->
    <div class="sp-card">
      <div class="sp-card-title">版本信息</div>
      <div class="kv">
        <div class="kv-item">
          <div class="kv-label">应用版本</div>
          <div class="kv-val">v{{ info.app?.version || '—' }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">数据模型</div>
          <div class="kv-val">
            {{ info.schema?.db || '—' }}
            <span class="dot" :class="info.schema?.matched ? 'ok' : 'warn'"></span>
          </div>
        </div>
        <div class="kv-item">
          <div class="kv-label">后台构建时间</div>
          <div class="kv-val">{{ BUILD_AT ? fmtTime(BUILD_AT) : '—' }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">当前运行的包</div>
          <div class="kv-val mono">{{ shortHash(curBundle) }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">Worker 兼容日期</div>
          <div class="kv-val mono">{{ info.app?.compat_date || '—' }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">部署版本</div>
          <div class="kv-val mono">{{ info.runtime?.deploy_id ? info.runtime.deploy_id.slice(0, 8) : '未开启' }}</div>
        </div>
      </div>
      <div class="hint" v-if="info.runtime && !info.runtime.deploy_id">
        控制台给 Worker 加 <code>version_metadata</code> 绑定后，这里会显示 Cloudflare 分配的真实部署版本号。
      </div>
    </div>

    <!-- 检查更新 -->
    <div class="sp-card">
      <div class="sp-card-title">
        检查更新
        <span class="tt-note">{{ ghNote || '对比线上部署与上游仓库' }}</span>
      </div>

      <div v-if="!rows.length" class="empty-check">正在检查…</div>
      <div v-else class="chk-list">
        <div class="chk" v-for="r in rows" :key="r.key">
          <el-icon class="chk-ic" :class="r.state" :size="18">
            <component :is="stateIcon(r.state)" />
          </el-icon>
          <div class="chk-main">
            <div class="chk-line">
              <span class="chk-label">{{ r.label }}</span>
              <span class="chk-title">{{ r.title }}</span>
              <a v-if="r.url" class="chk-link" :href="r.url" target="_blank" rel="noopener">
                查看<el-icon :size="11"><ArrowRight /></el-icon>
              </a>
            </div>
            <div class="chk-detail">{{ r.detail }}</div>
          </div>
        </div>
      </div>

      <div class="upd-tips">
        <div class="tip-line">
          <span class="tip-k">有新版本时：</span>
          <code>git pull</code> → <code>npm run build</code> → <code>npm run deploy</code>；
          GitHub 自动部署的仓库只要推送到 main 即可。
        </div>
        <div class="tip-line">
          <span class="tip-k">已经在页面上：</span>后台是构建产物且带哈希，部署后刷新一次页面（F5）才会加载新代码。
        </div>
      </div>
    </div>

    <!-- 项目情况 -->
    <div class="sp-card">
      <div class="sp-card-title">项目情况</div>

      <div class="chips">
        <span class="chip">Cloudflare Workers</span>
        <span class="chip">D1 · SQLite</span>
        <span class="chip">Static Assets</span>
        <span class="chip">Vue 3 + Element Plus</span>
        <span class="chip">Iconify</span>
        <span class="chip">WebDAV 备份</span>
      </div>

      <div class="stat-grid">
        <div class="stat">
          <el-icon class="si" :size="15"><Monitor /></el-icon>
          <div>
            <div class="st-label">定时任务</div>
            <div class="st-val">每小时整点扫描</div>
          </div>
        </div>
        <div class="stat">
          <el-icon class="si" :size="15"><Connection /></el-icon>
          <div>
            <div class="st-label">自动备份</div>
            <div class="st-val">
              {{ backup.enabled ? '已开启 · ' + (backup.freq || '') : '未开启' }}
              <span v-if="backup.enabled && backup.last_at" class="st-sub">
                {{ backup.last_ok ? '上次成功' : '上次失败' }} {{ relTime(backup.last_at) }}
              </span>
            </div>
          </div>
        </div>
        <div class="stat">
          <el-icon class="si" :size="15"><Clock /></el-icon>
          <div>
            <div class="st-label">访问保护</div>
            <div class="st-val">{{ features.access ? 'Access 已配置' : '未启用（靠会话）' }}</div>
          </div>
        </div>
        <div class="stat">
          <el-icon class="si" :size="15"><DataLine /></el-icon>
          <div>
            <div class="st-label">跨域</div>
            <div class="st-val">{{ features.cors ? '已放行指定来源' : '仅同源' }}</div>
          </div>
        </div>
      </div>

      <div class="figs">
        <div class="fig"><b>{{ data.groups || 0 }}</b><span>分组</span></div>
        <div class="fig"><b>{{ data.icons || 0 }}</b><span>卡片</span></div>
        <div class="fig"><b>{{ data.users || 0 }}</b><span>管理员</span></div>
        <div class="fig"><b>{{ data.visits || 0 }}</b><span>累计访问</span></div>
      </div>

      <div class="foot-note">
        会话密钥：{{ features.secret_from_env ? '环境变量 SECRET' : '自动生成并保存在 D1' }}
        · 服务器时间：{{ fmtTime(info.runtime?.now) }}
      </div>
    </div>

    <!-- 致谢：整块可点，点哪儿都跳得出去 -->
    <div class="sp-card">
      <div class="sp-card-title">致谢</div>

      <div class="thanks">
        <a class="th" href="https://github.com/hslr-s/sun-panel" target="_blank" rel="noopener">
          <span class="th-ic"><el-icon :size="17"><Sunny /></el-icon></span>
          <div class="th-main">
            <div class="th-head">
              <span class="th-name">sun-panel</span>
              <span class="th-tag">设计借鉴</span>
            </div>
            <div class="th-desc">
              本项目的整体布局、双主题与卡片交互都参考了 sun-panel 的开源实现，
              在此感谢作者的分享，让这个项目少走了很多弯路。
            </div>
          </div>
          <el-icon class="th-go" :size="14"><TopRight /></el-icon>
        </a>

        <a class="th" href="https://www.workbuddy.cn" target="_blank" rel="noopener">
          <span class="th-ic"><el-icon :size="17"><MagicStick /></el-icon></span>
          <div class="th-main">
            <div class="th-head">
              <span class="th-name">腾讯 WorkBuddy</span>
              <span class="th-tag">AI 协作</span>
            </div>
            <div class="th-desc">
              本项目的编码、调试与迭代过程大量借助腾讯 WorkBuddy 完成，
              感谢它把「想法到能跑起来的代码」这段路缩短了。
            </div>
          </div>
          <el-icon class="th-go" :size="14"><TopRight /></el-icon>
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .head-right { display: flex; align-items: center; gap: 12px; }
  .checked { font-size: 12px; color: var(--sp-faint); }

  /* ---------- 顶部身份卡 ---------- */
  .hero {
    display: flex; gap: 16px; align-items: flex-start;
    padding: 20px 22px; margin-bottom: 16px;
    border: 1px solid var(--sp-card-border); border-radius: var(--sp-radius);
    background:
      radial-gradient(ellipse 60% 120% at 0% 0%, rgba(var(--sp-accent-rgb), .15), transparent 70%),
      radial-gradient(ellipse 50% 120% at 100% 100%, rgba(var(--sp-accent-rgb), .07), transparent 70%),
      var(--sp-card);
  }
  /* 图形本身自带圆角底，这里只负责裁圆角和外发光；光用中性色 ——
     站点图标可以换成任意颜色，固定成蓝色会跟自定义图标打架 */
  .hero-logo {
    flex: 0 0 54px; width: 54px; height: 54px; border-radius: 15px;
    overflow: hidden; box-shadow: 0 4px 14px rgba(0, 0, 0, .22);
  }
  .hero-logo img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .hero-main { flex: 1; min-width: 0; }
  .hero-title {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 18px; font-weight: 700; letter-spacing: .3px; color: var(--sp-text);
  }
  .ver {
    font-size: 11.5px; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .12);
    border: 1px solid rgba(var(--sp-accent-rgb), .30);
  }
  .tag {
    font-size: 11.5px; padding: 2px 8px; border-radius: 999px;
    color: var(--sp-dim); background: var(--sp-chip-bg); border: 1px solid var(--sp-border);
  }
  .hero-desc { margin-top: 7px; font-size: 13px; line-height: 1.7; color: var(--sp-dim); }
  .hero-links { display: flex; gap: 9px; flex-wrap: wrap; margin-top: 12px; }
  .lk {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 12.5px; padding: 5px 11px; border-radius: 8px;
    text-decoration: none; color: var(--sp-btn-text);
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
    transition: background .15s, border-color .15s, color .15s;
  }
  .lk:hover { color: var(--sp-accent); border-color: rgba(var(--sp-accent-rgb), .45); background: var(--sp-hover); }

  /* ---------- 版本键值网格 ---------- */
  /* 6 项正好 3 列 × 2 行，比 auto-fit 的 4+2 更齐整 */
  .kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .kv-item { padding: 11px 13px; border-radius: 10px; background: var(--sp-card-in); border: 1px solid var(--sp-border); }
  .kv-label { font-size: 12px; color: var(--sp-dim); }
  .kv-val { margin-top: 5px; font-size: 13.5px; font-weight: 600; color: var(--sp-text); word-break: break-all; }
  .kv-val.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 500; }
  .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-left: 5px; vertical-align: 1px; }
  .dot.ok { background: var(--sp-ok); }
  .dot.warn { background: #e6a23c; }
  .hint { margin-top: 12px; font-size: 12px; line-height: 1.7; color: var(--sp-faint); }
  .hint code, .upd-tips code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; padding: 1px 5px; border-radius: 5px;
    background: var(--sp-chip-bg); color: var(--sp-text);
  }

  /* ---------- 检查结果 ---------- */
  .tt-note { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--sp-faint); }
  .empty-check { padding: 14px 0; font-size: 13px; color: var(--sp-faint); }
  .chk-list { display: flex; flex-direction: column; }
  .chk { display: flex; gap: 11px; padding: 12px 0; border-bottom: 1px dashed var(--sp-border); }
  .chk:first-child { padding-top: 2px; }
  .chk:last-child { border-bottom: 0; padding-bottom: 2px; }
  .chk-ic { flex: 0 0 18px; margin-top: 1px; }
  .chk-ic.ok { color: var(--sp-ok); }
  .chk-ic.warn { color: #e6a23c; }
  .chk-ic.err { color: var(--sp-danger); }
  .chk-ic.idle { color: var(--sp-faint); }
  .chk-main { flex: 1; min-width: 0; }
  .chk-line { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .chk-label {
    font-size: 11.5px; padding: 1px 7px; border-radius: 6px;
    color: var(--sp-dim); background: var(--sp-chip-bg); border: 1px solid var(--sp-border);
  }
  .chk-title { font-size: 13.5px; font-weight: 600; color: var(--sp-text); }
  .chk-link {
    display: inline-flex; align-items: center; gap: 2px; margin-left: auto;
    font-size: 12px; color: var(--sp-accent); text-decoration: none;
  }
  .chk-link:hover { text-decoration: underline; }
  .chk-detail { margin-top: 4px; font-size: 12.5px; line-height: 1.65; color: var(--sp-dim); word-break: break-word; }

  .upd-tips { margin-top: 14px; padding: 11px 13px; border-radius: 10px; background: var(--sp-card-in); }
  .tip-line { font-size: 12px; line-height: 1.9; color: var(--sp-dim); }
  .tip-k { color: var(--sp-faint); }

  /* ---------- 项目情况 ---------- */
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip {
    font-size: 12px; padding: 4px 10px; border-radius: 999px;
    color: var(--sp-dim); background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .stat-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(212px, 1fr));
    gap: 10px; margin-top: 14px;
  }
  .stat {
    display: flex; align-items: flex-start; gap: 9px;
    padding: 11px 13px; border-radius: 10px;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .si { color: var(--sp-accent); margin-top: 1px; }
  .st-label { font-size: 12px; color: var(--sp-dim); }
  .st-val { margin-top: 3px; font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .st-sub { display: block; margin-top: 2px; font-size: 11.5px; font-weight: 400; color: var(--sp-faint); }

  .figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 10px; margin-top: 14px; }
  .fig { padding: 12px 14px; border-radius: 10px; background: var(--sp-card-in); border: 1px solid var(--sp-border); }
  .fig b { display: block; font-size: 19px; font-weight: 700; color: var(--sp-text); line-height: 1.2; }
  .fig span { font-size: 12px; color: var(--sp-dim); }

  .foot-note { margin-top: 14px; font-size: 12px; color: var(--sp-faint); }

  /* ---------- 致谢 ---------- */
  .thanks { display: flex; flex-direction: column; gap: 8px; }
  /* 整行都是链接：不用「文字 + 小箭头」那种小目标 */
  .th {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--sp-border); border-radius: 10px;
    background: var(--sp-card-in); text-decoration: none; color: inherit;
    transition: border-color .15s, background .15s;
  }
  .th:hover { border-color: rgba(var(--sp-accent-rgb), .45); background: var(--sp-card); }
  .th:hover .th-go { color: var(--sp-accent); transform: translate(1px, -1px); }
  .th-ic {
    flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: var(--sp-card); color: var(--sp-accent);
    border: 1px solid var(--sp-border);
    transition: border-color .15s;
  }
  .th:hover .th-ic { border-color: rgba(var(--sp-accent-rgb), .45); }
  .th-main { flex: 1; min-width: 0; }
  .th-head { display: flex; align-items: center; gap: 7px; }
  .th-name { font-size: 13.5px; font-weight: 600; color: var(--sp-text); }
  .th-tag {
    font-size: 10.5px; line-height: 1; padding: 3px 6px; border-radius: 5px;
    color: var(--sp-dim); background: var(--sp-chip-bg);
  }
  .th-desc { font-size: 12px; color: var(--sp-dim); margin-top: 4px; line-height: 1.55; }
  .th-go { flex: none; color: var(--sp-faint); transition: color .15s, transform .15s; }

  @media (max-width: 900px) {
    .kv { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 768px) {
    .hero { flex-direction: column; gap: 12px; padding: 16px; }
    .head-right { width: 100%; justify-content: space-between; }
    .chk-link { margin-left: 0; }
    .kv { grid-template-columns: 1fr; }
    .th { align-items: flex-start; padding: 11px 12px; }
  }
</style>
