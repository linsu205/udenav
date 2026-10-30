<script setup lang="ts">
/**
 * 「浏览器插件」页：下载入口 + 安装/使用说明
 *
 * 为什么单独做一页而不是写进「关于」：
 *   关于页回答「这个项目是什么版本、有没有更新」，是给管理员看运行状态的；
 *   插件页回答「我怎么装、怎么用、出问题怎么办」，是给普通使用者照着做的。
 *   两类读者、两种语气，混在一起谁都读不顺。
 *
 * 版本号不写死在前端：Worker 代理查 GitHub 最新 release（浏览器直连会被 CORS 挡、
 * 也躲不开限流），拿不到就退化成「去 Releases 页自己选」，不会卡住整页。
 */
import { ref, computed, onMounted } from 'vue';
import { get } from '../api';
import { useStore } from '../store';
import { logoSrc } from '../lib/brand';
import { ElMessage } from 'element-plus';
import {
  Download, DocumentCopy, Link, TopRight, Refresh, ChromeFilled, Monitor, Promotion, Guide,
} from '@element-plus/icons-vue';

const store = useStore();
const icon = computed(() => logoSrc(store.config?.favicon));

const data = ref<any>({});
const loading = ref(false);
const failed = ref('');

const latest = computed(() => data.value.latest || null);
const zip = computed(() => (latest.value?.assets || [])[0] || null);
/* 下载按钮永远有去处：优先直连 zip，其次 Releases 列表页 */
const dlUrl = computed(() => zip.value?.url || data.value.releases || 'https://github.com/linsu205/udenav-extension/releases');

const browser = ref<'edge' | 'chrome'>('edge');
const extPage = computed(() => (browser.value === 'edge' ? 'edge://extensions' : 'chrome://extensions'));

function fmtDate(v?: string) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function fmtSize(n?: number) {
  if (!n) return '—';
  return n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

/* 复制：https 下用剪贴板接口，http 下它不存在（或权限被拒），退回 textarea + execCommand */
async function copy(text: string, tip = '链接已复制') {
  if (!text) return;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      ElMessage.success(tip);
      return;
    }
  } catch { /* 落到下面的兜底 */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    ElMessage.success(tip);
  } catch {
    ElMessage.warning('复制失败，请手动选中地址复制');
  }
}

/* 站点自己的地址：截图/演示时也能直接用 */
const siteUrl = computed(() => location.origin);

async function load() {
  loading.value = true;
  failed.value = '';
  try {
    const r = await get<any>('/api/admin/extension');
    data.value = r || {};
    if (!r?.latest) failed.value = r?.error || '暂时查不到插件版本信息';
  } catch (e: any) {
    failed.value = e?.message || '读取插件信息失败';
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const features = [
  { icon: ChromeFilled, title: '新建标签页就是导航页', desc: '按 Ctrl+T 打开的就是你自己的导航，不再落到浏览器默认的搜索页。' },
  { icon: Monitor, title: '内嵌 / 跳转两种方式', desc: '内嵌：地址栏保持新标签页、内容就是导航；跳转：新标签页直接跳到导航地址。' },
  { icon: Promotion, title: '点工具栏图标直接打开', desc: '浏览器右上角的 UDeNav 图标，点一下就在新标签里打开已设定好的导航。' },
];
</script>

<template>
  <div class="sp-page" v-loading="loading">
    <div class="sp-page-head">
      <div>
        <h2>浏览器插件</h2>
        <div class="sub">新建标签页直接打开你的导航 · Edge / Chrome 通用</div>
      </div>
      <div class="head-right">
        <el-button :icon="DocumentCopy" @click="copy(dlUrl, '下载地址已复制')">复制下载地址</el-button>
        <a class="dl-btn" :href="dlUrl" target="_blank" rel="noopener">
          <el-icon :size="14"><Download /></el-icon>
          <span>{{ zip ? '下载 ' + (latest?.version || '') : '去 Releases 下载' }}</span>
        </a>
      </div>
    </div>

    <!-- 身份卡 -->
    <div class="hero">
      <div class="hero-logo"><img :src="icon" alt="" /></div>
      <div class="hero-main">
        <div class="hero-title">
          UDeNav 新标签页
          <span class="ver" v-if="latest?.version">{{ latest.version }}</span>
          <span class="tag">MV3</span>
        </div>
        <div class="hero-desc">
          把新建标签页换成你自己的导航站。装一次、设一次地址，之后每次 Ctrl+T 都是这张页面。
        </div>
        <div class="hero-links">
          <a class="lk" :href="data.repo || 'https://github.com/linsu205/udenav-extension'" target="_blank" rel="noopener">
            <el-icon><Link /></el-icon>GitHub 仓库
          </a>
          <a class="lk" :href="data.releases || 'https://github.com/linsu205/udenav-extension/releases'" target="_blank" rel="noopener">
            <el-icon><TopRight /></el-icon>全部版本 Releases
          </a>
        </div>
      </div>
    </div>

    <!-- 版本信息 -->
    <div class="sp-card">
      <div class="sp-card-title">
        安装包
        <span class="tt-note" v-if="failed">{{ failed }}</span>
      </div>
      <div class="kv">
        <div class="kv-item">
          <div class="kv-label">最新版本</div>
          <div class="kv-val">{{ latest?.version || '—' }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">发布时间</div>
          <div class="kv-val">{{ fmtDate(latest?.date) }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">安装包大小</div>
          <div class="kv-val">{{ fmtSize(zip?.size) }}</div>
        </div>
        <div class="kv-item">
          <div class="kv-label">文件名</div>
          <div class="kv-val mono">{{ zip?.name || '—' }}</div>
        </div>
      </div>
      <div class="hint" v-if="failed">
        版本信息没取到不影响使用：点右上角「下载」会直接跳到 Releases 页，挑最新的
        <code>udenav-newtab-extension-*.zip</code> 即可。
        <el-button link type="primary" :icon="Refresh" @click="load">重新获取</el-button>
      </div>
      <div class="hint" v-else>
        下载到的是压缩包，需要按下面的步骤手动加载（未上架商店，所以不走一键安装）。
      </div>
    </div>

    <!-- 它能做什么 -->
    <div class="sp-card">
      <div class="sp-card-title">它能做什么</div>
      <div class="feat">
        <div class="ft" v-for="f in features" :key="f.title">
          <span class="ft-ic"><el-icon :size="15"><component :is="f.icon" /></el-icon></span>
          <div>
            <div class="ft-t">{{ f.title }}</div>
            <div class="ft-d">{{ f.desc }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 安装 -->
    <div class="sp-card">
      <div class="sp-card-title">
        安装步骤
        <div class="seg">
          <button type="button" :class="{ on: browser === 'edge' }" @click="browser = 'edge'">Edge</button>
          <button type="button" :class="{ on: browser === 'chrome' }" @click="browser = 'chrome'">Chrome</button>
        </div>
      </div>

      <ol class="steps">
        <li>
          <span class="st-n">1</span>
          <div class="st-b">
            <div class="st-t">下载并解压</div>
            <div class="st-d">
              把 zip 解压到一个<strong>固定的文件夹</strong>（例如 <code>D:\Tools\udenav-ext</code>）。
              扩展是直接从文件夹加载的，<strong>解压出来的文件夹不能删、不能挪</strong>，否则插件会失效。
            </div>
          </div>
        </li>
        <li>
          <span class="st-n">2</span>
          <div class="st-b">
            <div class="st-t">打开扩展管理页</div>
            <div class="st-d">
              地址栏输入 <code class="copy" @click="copy(extPage, '地址已复制')">{{ extPage }}</code> 回车。
            </div>
          </div>
        </li>
        <li>
          <span class="st-n">3</span>
          <div class="st-b">
            <div class="st-t">打开开发人员模式</div>
            <div class="st-d">Edge：页面<strong>左下角</strong>的「开发人员模式」；Chrome：页面<strong>右上角</strong>的「开发者模式」。</div>
          </div>
        </li>
        <li>
          <span class="st-n">4</span>
          <div class="st-b">
            <div class="st-t">加载解压缩的扩展</div>
            <div class="st-d">点「加载解压缩的扩展」（Edge）或「加载已解压的扩展程序」（Chrome），选中第 1 步解压出来的那个文件夹。</div>
          </div>
        </li>
        <li>
          <span class="st-n">5</span>
          <div class="st-b">
            <div class="st-t">验证一下</div>
            <div class="st-d">新开一个标签页：出现 UDeNav 的界面就成功了；工具栏右上角也会多一个 UDeNav 图标。</div>
          </div>
        </li>
      </ol>
    </div>

    <!-- 首次设置 -->
    <div class="sp-card">
      <div class="sp-card-title">首次设置</div>
      <ol class="steps">
        <li>
          <span class="st-n">1</span>
          <div class="st-b">
            <div class="st-t">打开设置</div>
            <div class="st-d">新标签页上点齿轮图标，或右键工具栏的 UDeNav 图标 →「选项」。</div>
          </div>
        </li>
        <li>
          <span class="st-n">2</span>
          <div class="st-b">
            <div class="st-t">填导航页地址</div>
            <div class="st-d">
              例如
              <code class="copy" @click="copy(siteUrl, '站点地址已复制')">{{ siteUrl }}</code>
              —— 也就是你现在看的这个网站的首页地址。不写 <code>https://</code> 也行，会自动补上。
            </div>
          </div>
        </li>
        <li>
          <span class="st-n">3</span>
          <div class="st-b">
            <div class="st-t">选打开方式</div>
            <div class="st-d">
              <div class="mode"><b>内嵌显示</b>（默认，推荐）：新标签页地址栏不变，内容是导航页；能在插件里直接登录后台。</div>
              <div class="mode"><b>跳转打开</b>：新标签页立刻跳到导航地址（会显示完整网址）。某些网站不允许被内嵌、或内嵌里登录不顺时，用它。</div>
            </div>
          </div>
        </li>
        <li>
          <span class="st-n">4</span>
          <div class="st-b">
            <div class="st-t">保存并测试</div>
            <div class="st-d">点「保存」，再点「测试」看效果；设置只存在这台电脑的浏览器里，换电脑/换浏览器要重新设一次。</div>
          </div>
        </li>
      </ol>
    </div>

    <!-- 更新 -->
    <div class="sp-card">
      <div class="sp-card-title">以后怎么更新</div>
      <div class="upd">
        <div class="upd-line"><span class="upd-k">1</span>下载新版本的 zip，解压后<strong>覆盖</strong>原来那个文件夹（保持路径不变，设置不会丢）。</div>
        <div class="upd-line"><span class="upd-k">2</span>回到扩展管理页，找到 UDeNav，点它卡片上的「重新加载」（刷新图标）。</div>
        <div class="upd-line"><span class="upd-k">3</span>关掉旧标签页，重新按 Ctrl+T 查看效果。</div>
      </div>
      <div class="hint">
        想省事也可以：把文件夹里的旧文件删掉，重新「加载解压缩的扩展」一次；已保存的地址和设置仍会在。
      </div>
    </div>

    <!-- 常见问题 -->
    <div class="sp-card">
      <div class="sp-card-title">常见问题</div>
      <div class="faq">
        <div class="fa">
          <div class="fa-q">新标签页还是浏览器原来的样子？</div>
          <div class="fa-a">同一个浏览器里只能有一个扩展接管新标签页。到扩展管理页把其它「新标签页 / 主页」类扩展停用，再试。</div>
        </div>
        <div class="fa">
          <div class="fa-q">打开是空白，或提示无法访问此页面？</div>
          <div class="fa-a">先确认设置的地址能在浏览器里直接打开；地址写错、或这个地址在你当前网络下打不开，插件里也一样打不开。</div>
        </div>
        <div class="fa">
          <div class="fa-q">在插件里登录后台，一直提示「登录已过期」？</div>
          <div class="fa-a">用 v1.1.1 及以上版本（修的就是内嵌页面里的登录 Cookie）。仍不行就把打开方式改成「跳转打开」。</div>
        </div>
        <div class="fa">
          <div class="fa-q">卸载插件后新标签页变回默认了？</div>
          <div class="fa-a">正常现象，浏览器会自动恢复默认新标签页；导航站本身的数据都在服务器上，不受影响。</div>
        </div>
        <div class="fa">
          <div class="fa-q">会不会把我的导航地址上传到别处？</div>
          <div class="fa-a">不会。扩展只在本地保存一个地址字符串，不收集任何数据、不发额外请求。</div>
        </div>
      </div>
    </div>

    <!-- 来源 -->
    <div class="sp-card">
      <div class="sp-card-title">下载来源</div>
      <a class="src" :href="data.releases || 'https://github.com/linsu205/udenav-extension/releases'" target="_blank" rel="noopener">
        <span class="src-ic"><el-icon :size="16"><Guide /></el-icon></span>
        <div class="src-main">
          <div class="src-t">GitHub Releases（官方唯一来源）</div>
          <div class="src-d">所有历史版本都在这里；本项目不从任何第三方站点分发安装包。</div>
        </div>
        <el-icon class="src-go" :size="14"><TopRight /></el-icon>
      </a>
    </div>
  </div>
</template>

<style scoped>
  .head-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  /* 主按钮做成链接：下载是跳转，不是发请求，用 <a> 才能让浏览器自己处理下载 */
  .dl-btn {
    display: inline-flex; align-items: center; gap: 6px;
    height: 32px; padding: 0 15px; border-radius: 8px;
    font-size: 13px; font-weight: 500; text-decoration: none;
    color: #fff; background: var(--sp-accent);
    border: 1px solid var(--sp-accent);
    transition: filter .15s, transform .15s;
  }
  .dl-btn:hover { filter: brightness(1.08); }
  .dl-btn:active { transform: translateY(1px); }

  /* ---------- 身份卡 ---------- */
  .hero {
    display: flex; gap: 16px; align-items: flex-start;
    padding: 20px 22px; margin-bottom: 16px;
    border: 1px solid var(--sp-card-border); border-radius: var(--sp-radius);
    background:
      radial-gradient(ellipse 60% 120% at 0% 0%, rgba(var(--sp-accent-rgb), .15), transparent 70%),
      radial-gradient(ellipse 50% 120% at 100% 100%, rgba(var(--sp-accent-rgb), .07), transparent 70%),
      var(--sp-card);
  }
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

  /* ---------- 版本键值 ---------- */
  .tt-note { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--sp-faint); }
  .kv { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .kv-item { padding: 11px 13px; border-radius: 10px; background: var(--sp-card-in); border: 1px solid var(--sp-border); }
  .kv-label { font-size: 12px; color: var(--sp-dim); }
  .kv-val { margin-top: 5px; font-size: 13.5px; font-weight: 600; color: var(--sp-text); word-break: break-all; }
  .kv-val.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; font-weight: 500; }
  .hint { margin-top: 12px; font-size: 12px; line-height: 1.9; color: var(--sp-faint); }
  .hint code, .st-d code, .mode code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px; padding: 1px 6px; border-radius: 5px;
    background: var(--sp-chip-bg); color: var(--sp-text);
  }
  .hint code.copy, .st-d code.copy { cursor: pointer; border: 1px dashed rgba(var(--sp-accent-rgb), .5); color: var(--sp-accent); }
  .hint code.copy:hover, .st-d code.copy:hover { background: var(--sp-hover); }

  /* ---------- 功能三块 ---------- */
  .feat { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
  .ft {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 12px 13px; border-radius: 10px;
    background: var(--sp-card-in); border: 1px solid var(--sp-border);
  }
  .ft-ic {
    flex: 0 0 28px; width: 28px; height: 28px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    background: var(--sp-card); color: var(--sp-accent);
    border: 1px solid var(--sp-border);
  }
  .ft-t { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .ft-d { margin-top: 4px; font-size: 12px; line-height: 1.65; color: var(--sp-dim); }

  /* ---------- 浏览器切换 ---------- */
  .seg { margin-left: auto; display: inline-flex; gap: 4px; padding: 2px; border-radius: 8px; background: var(--sp-card-in); border: 1px solid var(--sp-border); }
  .seg button {
    font: inherit; font-size: 12px; line-height: 1; padding: 5px 10px; border-radius: 6px;
    border: 0; background: transparent; color: var(--sp-dim); cursor: pointer;
    transition: background .15s, color .15s;
  }
  .seg button:hover { color: var(--sp-text); }
  .seg button.on { background: var(--sp-card); color: var(--sp-accent); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, .12); }

  /* ---------- 步骤 ---------- */
  .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
  .steps li { display: flex; gap: 11px; align-items: flex-start; }
  .st-n {
    flex: 0 0 22px; width: 22px; height: 22px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; margin-top: 1px;
    color: var(--sp-accent); background: rgba(var(--sp-accent-rgb), .12);
    border: 1px solid rgba(var(--sp-accent-rgb), .30);
  }
  .st-b { flex: 1; min-width: 0; }
  .st-t { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .st-d { margin-top: 4px; font-size: 12.5px; line-height: 1.75; color: var(--sp-dim); }
  .st-d strong { color: var(--sp-text); font-weight: 600; }
  .mode { margin-top: 4px; }
  .mode b { color: var(--sp-text); font-weight: 600; }

  /* ---------- 更新 ---------- */
  .upd { display: flex; flex-direction: column; gap: 8px; }
  .upd-line { display: flex; gap: 9px; font-size: 12.5px; line-height: 1.75; color: var(--sp-dim); }
  .upd-k {
    flex: 0 0 18px; width: 18px; height: 18px; border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; font-weight: 700; margin-top: 2px;
    color: var(--sp-dim); background: var(--sp-chip-bg); border: 1px solid var(--sp-border);
  }
  .upd-line strong { color: var(--sp-text); font-weight: 600; }

  /* ---------- FAQ ---------- */
  .faq { display: flex; flex-direction: column; }
  .fa { padding: 11px 0; border-bottom: 1px dashed var(--sp-border); }
  .fa:first-child { padding-top: 2px; }
  .fa:last-child { border-bottom: 0; padding-bottom: 2px; }
  .fa-q { font-size: 13px; font-weight: 600; color: var(--sp-text); }
  .fa-a { margin-top: 4px; font-size: 12.5px; line-height: 1.75; color: var(--sp-dim); }

  /* ---------- 来源 ---------- */
  .src {
    display: flex; align-items: center; gap: 12px; padding: 12px 14px;
    border: 1px solid var(--sp-border); border-radius: 10px;
    background: var(--sp-card-in); text-decoration: none; color: inherit;
    transition: border-color .15s, background .15s;
  }
  .src:hover { border-color: rgba(var(--sp-accent-rgb), .45); background: var(--sp-card); }
  .src:hover .src-go { color: var(--sp-accent); transform: translate(1px, -1px); }
  .src-ic {
    flex: 0 0 34px; width: 34px; height: 34px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    background: var(--sp-card); color: var(--sp-accent); border: 1px solid var(--sp-border);
  }
  .src-main { flex: 1; min-width: 0; }
  .src-t { font-size: 13.5px; font-weight: 600; color: var(--sp-text); }
  .src-d { margin-top: 3px; font-size: 12px; color: var(--sp-dim); }
  .src-go { flex: none; color: var(--sp-faint); transition: color .15s, transform .15s; }

  @media (max-width: 768px) {
    .head-right { width: 100%; justify-content: flex-end; }
    .kv { grid-template-columns: 1fr; }
    .hero { flex-direction: column; gap: 12px; padding: 16px; }
  }
</style>
