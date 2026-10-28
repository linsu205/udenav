<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, get } from '../api';
import { useStore } from '../store';
import { ElMessage } from 'element-plus';
import ModalShell from './ModalShell.vue';
import { VideoPlay, Odometer, Clock, User, TrendCharts, Coin, DataLine, Monitor, Link, Connection, WarningFilled } from '@element-plus/icons-vue';

const store = useStore();
const st = ref<any>({});
const loading = ref(false);
const updated = ref('');

// 后台页面自身加载的资源体积（performance API 实测）
const res = ref({ js: 0, css: 0, img: 0, oth: 0, jsN: 0 });
const resOk = ref(true);
const envInfo = ref<any>({});

const maxT = computed(() => Math.max(1, ...(st.value.trend || []).map((t: any) => t.n || 0)));
const avgT = computed(() => {
  const t = st.value.trend || [];
  return t.length ? Math.round((t.reduce((a: number, x: any) => a + (x.n || 0), 0) / t.length) * 10) / 10 : 0;
});
const peakT = computed(() => {
  const t = st.value.trend || [];
  return t.length ? Math.max(...t.map((x: any) => x.n || 0)) : 0;
});
const stackList = computed(() => (st.value.db?.list || []).filter((t: any) => t.bytes > 0));
const topT = computed(() => (st.value.db?.list || [])[0]);

// 页面体积：总量与分段占比（用于堆叠比例条）
const resTotal = computed(() => res.value.js + res.value.css + res.value.img + res.value.oth);
const resSegs = computed(() => {
  const r = res.value, t = resTotal.value || 1;
  return [
    { key: 'js', label: 'JS 脚本', v: r.js, color: '#409eff' },
    { key: 'css', label: '样式表', v: r.css, color: '#a78bfa' },
    { key: 'img', label: '图片', v: r.img, color: '#2fbf6b' },
    { key: 'oth', label: '其他', v: r.oth, color: '#e6a23c' },
  ].map(s => ({ ...s, pct: Math.max(s.v > 0 ? 1.5 : 0, s.v / t * 100) }));
});
// 浏览器 / 系统一句话摘要
const uaBrief = computed(() => {
  const ua = String(envInfo.value.ua || '');
  const br = (() => {
    if (/Edg\//.test(ua)) return 'Edge';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua)) return 'Safari';
    return '未知浏览器';
  })();
  const os = (() => {
    if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad/.test(ua)) return 'iOS';
    if (/Linux/.test(ua)) return 'Linux';
    return '未知系统';
  })();
  const mv = ua.match(/(?:Chrome|Edg|Firefox|Version)\/(\d+)/);
  return `${br}${mv ? ' ' + mv[1] : ''} · ${os}`;
});

function fmt(n: number): string {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}
function fmtDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function measureResources() {
  const rs = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  let js = 0, css = 0, img = 0, oth = 0, jsN = 0;
  for (const e of rs) {
    const u = e.name.toLowerCase();
    const size = e.decodedBodySize || e.transferSize || 0;
    if (/\.(js|mjs)(\?|$)/.test(u)) { js += size; jsN++; }
    else if (/\.css(\?|$)/.test(u)) css += size;
    else if (/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/.test(u)) img += size;
    else oth += size;
  }
  res.value = { js, css, img, oth, jsN };
  resOk.value = (js + css + img + oth) > 0;
  envInfo.value = {
    ua: navigator.userAgent,
    lang: navigator.language,
    screen: `${screen.width} × ${screen.height}`,
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dom: document.querySelectorAll('*').length,
  };
}

async function load() {
  loading.value = true;
  try {
    st.value = await get('/api/admin/stats');
    updated.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } finally {
    loading.value = false;
  }
  measureResources();
}
onMounted(load);

/* ---------------- 清理访问日志 ---------------- */
const purgeOpen = ref(false);
const keep = ref(30);          // 0 = 全部清空，其余 = 只保留最近 N 天
const purging = ref(false);

function openPurge() {
  keep.value = 30;
  purgeOpen.value = true;
}

async function doPurge() {
  purging.value = true;
  try {
    const body = keep.value === 0 ? { mode: 'all' } : { mode: 'days', days: keep.value };
    const r = await api<any>('DELETE', '/api/admin/logs', body);
    const n = Number(r?.deleted || 0);
    ElMessage.success(n ? `已清理 ${n} 行日志` : '没有需要清理的日志');
    purgeOpen.value = false;
    await load();
  } catch (e: any) {
    ElMessage.error(e?.message || '清理失败');
  } finally {
    purging.value = false;
  }
}
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>访问统计</h2>
        <div class="sub">访客访问计数 · 数据库占用 · 页面体积</div>
      </div>
      <div class="head-right">
        <span v-if="updated" class="upd">更新于 {{ updated }}</span>
        <el-button :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <!-- KPI -->
    <div class="kpi-grid">
      <div class="kpi" style="--kc:#2fbf6b">
        <div class="kpi-label">累计访问</div>
        <div class="kpi-num">{{ st.total_visits || 0 }}</div>
        <div class="kpi-sub">上线以来全部请求</div>
        <el-icon class="kpi-ic" :size="30">
          <VideoPlay />
        </el-icon>
      </div>
      <div class="kpi" style="--kc:#409eff">
        <div class="kpi-label">今天访问</div>
        <div class="kpi-num">{{ st.visits_today || 0 }}</div>
        <div class="kpi-sub">东八区当日 0 点起</div>
        <el-icon class="kpi-ic" :size="30">
          <Odometer />
        </el-icon>
      </div>
      <div class="kpi" style="--kc:#e6a23c">
        <div class="kpi-label">最近 24 小时</div>
        <div class="kpi-num">{{ st.visits_24h || 0 }}</div>
        <div class="kpi-sub">滚动 24 小时窗口</div>
        <el-icon class="kpi-ic" :size="30">
          <Clock />
        </el-icon>
      </div>
      <div class="kpi" style="--kc:#a78bfa">
        <div class="kpi-label">独立访客</div>
        <div class="kpi-num">{{ st.log?.ips || 0 }}</div>
        <div class="kpi-sub">去重 IP 哈希</div>
        <el-icon class="kpi-ic" :size="30">
          <User />
        </el-icon>
      </div>
    </div>

    <!-- 近 14 天趋势 -->
    <div class="sp-card">
      <div class="sp-card-title">
        近 14 天访问趋势
        <span class="tt-note">日均 {{ avgT }} 次 · 峰值 {{ peakT }} 次</span>
      </div>
      <div class="trend">
        <div class="tbar" v-for="t in st.trend || []" :key="t.day" :title="t.day + '  ·  ' + (t.n || 0) + ' 次'">
          <div class="zone">
            <div class="col" :style="{ height: ((t.n || 0) / maxT * 100) + '%' }"></div>
          </div>
          <div class="lb">{{ t.day.slice(5) }}</div>
        </div>
      </div>
    </div>

    <!-- 数据占用总览 -->
    <div class="sp-card">
      <div class="sp-card-title">
        数据占用
        <span class="tt-note">D1 数据库实际写入量 · 按 UTF-8 字节估算</span>
      </div>
      <div class="ov">
        <div class="ov-left">
          <div class="ov-num">{{ fmt(st.db?.bytes_total || 0) }}</div>
          <div class="ov-sub">{{ st.db?.rows_total || 0 }} 行数据 · {{ st.db?.tables || 0 }} 张表</div>
        </div>
        <div class="ov-right">
          <div class="ov-item"><span>最大占用</span><b>{{ topT?.label || '—' }}</b></div>
          <div class="ov-item"><span>占总容量</span><b>{{ topT?.pct || 0 }}%</b></div>
          <div class="ov-item"><span>分组 / 卡片</span><b>{{ st.groups || 0 }} / {{ st.icons || 0 }}</b></div>
        </div>
      </div>

      <div class="stack">
        <i v-for="t in stackList" :key="t.key" :style="{ width: t.pct + '%', background: t.color }"
          :title="t.label + '  ' + fmt(t.bytes)"></i>
      </div>

      <div class="srow" v-for="t in st.db?.list || []" :key="t.key">
        <span class="dot" :style="{ background: t.color }"></span>
        <span class="lbl">{{ t.label }}</span>
        <div class="sbar"><i :style="{ width: t.pct + '%', background: t.color }"></i></div>
        <span class="bytes">{{ fmt(t.bytes) }}</span>
        <span class="rows">{{ t.rows }} 行</span>
      </div>
    </div>

    <!-- 图标资源 + 访问日志 -->
    <div class="row2">
      <div class="sp-card">
        <div class="sp-card-title">卡片图标占用</div>
        <div class="big2">
          <div class="b2">
            <div class="b2-n">{{ st.icon?.inline || 0 }}</div>
            <div class="b2-l">内联图片</div>
          </div>
          <div class="b2">
            <div class="b2-n">{{ fmt(st.icon?.inline_bytes || 0) }}</div>
            <div class="b2-l">图片总数据</div>
          </div>
        </div>
        <div class="kv"><span>单张最大</span><b>{{ fmt(st.icon?.inline_max || 0) }}</b></div>
        <div class="kv"><span>外链图标</span><b>{{ st.icon?.linked || 0 }} 个</b></div>
        <div class="note">内联图片是把整张图存成 data: 编码写进数据库，是卡片体积的主要来源；外链只存一个地址，几乎不占空间。</div>
      </div>

      <div class="sp-card">
        <div class="sp-card-title">
          访问日志占用
          <el-button class="tt-btn" size="small" @click="openPurge">清理日志</el-button>
        </div>

        <div v-if="st.log?.warn" class="warn">
          <el-icon :size="14">
            <WarningFilled />
          </el-icon>
          <span>
            日志已有 <b>{{ st.log?.rows || 0 }}</b> 行 / <b>{{ fmt(st.log?.bytes || 0) }}</b>，
            超过建议上限 {{ st.log?.warn_rows }} 行 / {{ fmt(st.log?.warn_bytes || 0) }}
          </span>
        </div>

        <div class="big2">
          <div class="b2">
            <div class="b2-n">{{ fmt(st.log?.bytes || 0) }}</div>
            <div class="b2-l">日志总数据</div>
          </div>
          <div class="b2">
            <div class="b2-n">{{ st.log?.rows || 0 }}</div>
            <div class="b2-l">日志行数</div>
          </div>
        </div>
        <div class="kv"><span>独立 IP</span><b>{{ st.log?.ips || 0 }} 个</b></div>
        <div class="kv"><span>浏览器种类</span><b>{{ st.log?.uas || 0 }} 种</b></div>
        <div class="kv"><span>记录区间</span><b>{{ fmtDate(st.log?.oldest) }} → {{ fmtDate(st.log?.newest) }}</b></div>
        <div class="note">
          日志只记 IP 哈希、路径和 UA，不记明文 IP，也不收集任何个人信息。
          建议上限 {{ st.log?.warn_rows || 5000 }} 行 / {{ fmt(st.log?.warn_bytes || 0) }}，超过后这里会提示。
        </div>
      </div>
    </div>

    <!-- 页面体积 + 运行环境 -->
    <div class="row2">
      <div class="sp-card">
        <div class="sp-card-title">
          后台页面体积
          <span class="tt-note">performance API 实测本次加载</span>
        </div>
        <div v-if="resTotal > 0" class="res-total">
          <span class="res-total-n">{{ fmt(resTotal) }}</span>
          <span class="res-total-l">本次加载总量</span>
        </div>
        <div v-if="resTotal > 0" class="res-bar">
          <i v-for="s in resSegs" :key="s.key" :style="{ width: s.pct + '%', background: s.color }"
            :title="s.label + '  ' + fmt(s.v)"></i>
        </div>
        <div class="res">
          <div class="res-i" v-for="s in resSegs" :key="s.key">
            <div class="res-hd"><i class="res-dot" :style="{ background: s.color }"></i><span class="res-l">{{ s.label
                }}</span></div>
            <div class="res-n">{{ fmt(s.v) }}</div>
            <div class="res-s">{{ s.key === 'js' ? res.jsN + ' 个文件' : s.key === 'css' ? 'Element Plus + 主题' : s.key ===
              'img' ? '内联 SVG / favicon' : '字体 / 请求' }}</div>
          </div>
        </div>
        <div v-if="!resOk" class="note">资源体积为 0，说明全部命中浏览器缓存；点「刷新」前按 Ctrl+F5 强制重载可测到实际大小。</div>
      </div>

      <div class="sp-card">
        <div class="sp-card-title">当前运行环境</div>
        <div class="env-hero">
          <el-icon :size="20">
            <Monitor />
          </el-icon>
          <div>
            <div class="env-hero-t">{{ uaBrief }}</div>
            <div class="env-hero-s">{{ envInfo.lang || '—' }} · {{ envInfo.tz }}</div>
          </div>
        </div>
        <div class="env-chips">
          <div class="chip"><span>屏幕</span><b>{{ envInfo.screen || '—' }}</b></div>
          <div class="chip"><span>视口</span><b>{{ envInfo.viewport || '—' }}</b></div>
          <div class="chip"><span>缩放</span><b>{{ envInfo.dpr }}×</b></div>
          <div class="chip"><span>DOM</span><b>{{ envInfo.dom || 0 }} 节点</b></div>
        </div>
        <div class="kv"><span>登录身份</span><b>{{ store.user?.username }}</b></div>
        <div class="kv"><span>浏览器 UA</span><b class="ell" :title="envInfo.ua">{{ envInfo.ua || '—' }}</b></div>
        <div class="kv"><span>部署环境</span><b>Cloudflare Workers</b></div>
      </div>
    </div>

    <!-- 说明 -->
    <div class="sp-card">
      <div class="sp-card-title">统计口径说明</div>
      <ul class="notes">
        <li><b>访问计数</b>来自访客打开首页时的 /api/public/panel 请求，按 IP 哈希去重，只存哈希不存明文。</li>
        <li><b>数据占用</b>是把每张表的文本列转成 UTF-8 字节累加、数字列每行按 8 字节计得出的估算值，不是 Cloudflare 控制台上显示的 D1 磁盘用量（那个含页填充和索引开销，实际会更大一些）。
        </li>
        <li><b>页面体积</b>只统计后台这一个页面本次加载的资源，不含访客首页和后台数据库。</li>
        <li>想清理占用，主要看<b>「卡片图标占用」</b>：把大图片改成外链地址，或减小上传尺寸，数据库会立刻变小。</li>
        <li><b>访问日志</b>可以直接清：点「清理日志」，可选只保留最近 7 / 30 天或全部清空。清理后「累计访问」「今天」「24 小时」和趋势图会按剩余日志重新计算，历史数字会随之下降。</li>
      </ul>
    </div>

    <!-- 清理访问日志 -->
    <!-- 弹窗统一走 ModalShell：不锁 body 滚动，滚动条不会消失、页面不抖 -->
    <ModalShell v-if="purgeOpen" title="清理访问日志" width="440px" @close="purgeOpen = false">
      <div class="pg-now">
        当前共 <b>{{ st.log?.rows || 0 }}</b> 行 · <b>{{ fmt(st.log?.bytes || 0) }}</b>
      </div>
      <el-radio-group v-model="keep" class="pg-mode">
        <el-radio :value="7">只保留最近 7 天</el-radio>
        <el-radio :value="30">只保留最近 30 天</el-radio>
        <el-radio :value="0">全部清空</el-radio>
      </el-radio-group>
      <div class="pg-tip">
        <template v-if="keep === 0">
          会删掉全部访问日志，卡片、分组、配置都不受影响。
        </template>
        <template v-else>
          只删除 {{ keep }} 天以前的记录，最近的日志保留。
        </template>
        清理后「累计访问」「今天」「24 小时」和趋势图会按剩余日志重新计算。
      </div>
      <template #footer>
        <el-button @click="purgeOpen = false">取消</el-button>
        <el-button type="danger" :loading="purging" @click="doPurge">确认清理</el-button>
      </template>
    </ModalShell>
  </div>
</template>

<style scoped>
.head-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.upd {
  font-size: 12px;
  color: var(--sp-faint);
}

/* KPI */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 14px;
  margin-bottom: 16px;
}

.kpi {
  position: relative;
  overflow: hidden;
  background: var(--sp-card);
  border: 1px solid var(--sp-card-border);
  border-radius: 12px;
  padding: 15px 18px 15px 22px;
}

.kpi::before {
  content: '';
  position: absolute;
  left: 0;
  top: 11px;
  bottom: 11px;
  width: 3px;
  border-radius: 0 2px 2px 0;
  background: var(--kc, var(--sp-accent));
}

.kpi-label {
  font-size: 12.5px;
  color: var(--sp-dim);
}

.kpi-num {
  font-size: 30px;
  font-weight: 700;
  color: var(--sp-text);
  letter-spacing: .5px;
  margin-top: 6px;
  line-height: 1.1;
}

.kpi-sub {
  font-size: 11.5px;
  color: var(--sp-faint);
  margin-top: 6px;
}

.kpi-ic {
  position: absolute;
  right: 11px;
  top: 11px;
  color: var(--kc);
  opacity: .22;
}

.tt-note {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 400;
  color: var(--sp-faint);
}

.tt-btn {
  margin-left: auto;
  font-weight: 400;
}

/* 日志超限提示 */
.warn {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  padding: 9px 12px;
  margin-bottom: 14px;
  border-radius: 9px;
  background: rgba(230, 162, 60, .12);
  border: 1px solid rgba(230, 162, 60, .32);
  color: #e6a23c;
  font-size: 12.5px;
  line-height: 1.5;
}

.warn b {
  color: #e6a23c;
}

/* 清理日志弹窗 */
.pg-now {
  font-size: 13px;
  color: var(--sp-dim);
  margin-bottom: 14px;
}

.pg-now b {
  color: var(--sp-text);
}

.pg-mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.pg-tip {
  margin-top: 16px;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--sp-card-in);
  font-size: 12px;
  line-height: 1.6;
  color: var(--sp-dim);
}

/* 趋势柱状图 */
.trend {
  display: flex;
  gap: 5px;
  height: 116px;
  align-items: stretch;
}

.tbar {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
}

.tbar .zone {
  height: 92px;
  display: flex;
  align-items: flex-end;
}

.tbar .col {
  width: 100%;
  max-width: 30px;
  margin: 0 auto;
  min-height: 2px;
  border-radius: 5px 5px 2px 2px;
  background: linear-gradient(180deg, var(--sp-accent), rgba(var(--sp-accent-rgb), .38));
  transition: height .35s ease;
}

.tbar:hover .col {
  background: linear-gradient(180deg, #79bbff, rgba(var(--sp-accent-rgb), .45));
}

.tbar .lb {
  font-size: 10.5px;
  color: var(--sp-faint);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}

/* 数据占用 */
.ov {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
  flex-wrap: wrap;
}

.ov-num {
  font-size: 32px;
  font-weight: 700;
  color: var(--sp-accent);
  letter-spacing: .5px;
  line-height: 1.1;
}

.ov-sub {
  font-size: 12.5px;
  color: var(--sp-dim);
  margin-top: 6px;
}

.ov-right {
  display: flex;
  gap: 26px;
}

.ov-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ov-item span {
  font-size: 11.5px;
  color: var(--sp-faint);
}

.ov-item b {
  font-size: 14px;
  color: var(--sp-text);
  font-weight: 600;
}

.stack {
  display: flex;
  gap: 2px;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 14px;
  background: var(--sp-card-in);
}

.stack i {
  display: block;
  height: 100%;
  border-radius: 0;
}

.srow {
  display: grid;
  grid-template-columns: 10px 84px 1fr 76px 62px;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-top: 1px solid var(--sp-card-border);
}

.srow .dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}

.srow .lbl {
  font-size: 13px;
  color: var(--sp-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sbar {
  height: 6px;
  border-radius: 3px;
  background: var(--sp-card-in);
  overflow: hidden;
}

.sbar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width .35s ease;
}

.srow .bytes {
  font-size: 12.5px;
  color: var(--sp-dim);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.srow .rows {
  font-size: 11.5px;
  color: var(--sp-faint);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 两列并排 */
.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}

.row2>.sp-card {
  margin-bottom: 0;
}

.big2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.b2 {
  background: var(--sp-card-in);
  border-radius: 10px;
  padding: 13px 14px;
  text-align: center;
}

.b2-n {
  font-size: 21px;
  font-weight: 700;
  color: var(--sp-text);
  line-height: 1.15;
}

.b2-l {
  font-size: 11.5px;
  color: var(--sp-dim);
  margin-top: 5px;
}

.kv {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--sp-card-border);
  font-size: 13px;
}

.kv span {
  color: var(--sp-dim);
  flex: none;
}

.kv b {
  color: var(--sp-text);
  font-weight: 600;
  text-align: right;
}

.kv b.ell {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.res {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

.res-i {
  background: var(--sp-card-in);
  border-radius: 10px;
  padding: 12px 14px;
  transition: transform .18s ease, box-shadow .18s ease;
}

.res-i:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, .07);
}

.res-hd {
  display: flex;
  align-items: center;
  gap: 7px;
}

.res-dot {
  width: 8px;
  height: 8px;
  border-radius: 3px;
  flex: none;
}

.res-n {
  font-size: 20px;
  font-weight: 700;
  color: var(--sp-text);
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.res-l {
  font-size: 12.5px;
  color: var(--sp-dim);
}

.res-s {
  font-size: 11px;
  color: var(--sp-faint);
  margin-top: 2px;
}

/* 页面体积：汇总 + 占比条 */
.res-total {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}

.res-total-n {
  font-size: 26px;
  font-weight: 700;
  color: var(--sp-accent);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}

.res-total-l {
  font-size: 12px;
  color: var(--sp-faint);
}

.res-bar {
  display: flex;
  gap: 2px;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--sp-card-in);
  margin-bottom: 12px;
}

.res-bar i {
  display: block;
  height: 100%;
  transition: width .35s ease;
}

/* 运行环境：英雄区 + 信息 chips */
.env-hero {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--sp-card-in);
  border-radius: 10px;
  padding: 13px 14px;
  margin-bottom: 12px;
  color: var(--sp-accent);
}

.env-hero-t {
  font-size: 15px;
  font-weight: 700;
  color: var(--sp-text);
  line-height: 1.3;
}

.env-hero-s {
  font-size: 11.5px;
  color: var(--sp-faint);
  margin-top: 3px;
}

.env-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}

.chip {
  background: var(--sp-card-in);
  border-radius: 9px;
  padding: 9px 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
  min-width: 0;
}

.chip span {
  font-size: 10.5px;
  color: var(--sp-faint);
}

.chip b {
  font-size: 12.5px;
  color: var(--sp-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 说明列表 */
.notes {
  margin: 2px 0 0;
  padding: 0;
  list-style: none;
}

.notes li {
  position: relative;
  padding: 7px 0 7px 18px;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--sp-dim);
  border-top: 1px dashed var(--sp-card-border);
}

.notes li:first-child {
  border-top: 0;
  padding-top: 2px;
}

.notes li::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 15px;
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: var(--sp-accent);
  opacity: .55;
}

.notes li:first-child::before {
  top: 10px;
}

.notes li b {
  color: var(--sp-text);
  font-weight: 600;
}

.note {
  color: var(--sp-faint);
  font-size: 12.5px;
  line-height: 1.9;
}

@media (max-width: 768px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .row2 {
    grid-template-columns: 1fr;
  }

  .srow {
    grid-template-columns: 10px 74px 1fr 66px 54px;
    gap: 8px;
  }

  .tbar .lb {
    font-size: 9.5px;
  }

  .kv b.ell {
    max-width: 210px;
  }

  .env-chips {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
