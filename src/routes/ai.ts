// AI 能力接入（模型服务适配层）
//
// 设计要点：
// 1) 只走 OpenAI 兼容的 /chat/completions 协议 —— DeepSeek、通义千问、智谱、Kimi、
//    Cloudflare Workers AI 的 OpenAI 兼容端点、自建 vLLM 都是这一套，换服务商只改配置。
// 2) 密钥落库前用 SECRET 派生的 AES-GCM 加密（复用 webdav 的 encryptSecret），
//    并且存 app_setting（系统级表，不参与导出/备份）。接口只回 has_key 和末四位。
// 3) 未填密钥时整套是空壳：/ai/fill 直接拒绝，不会「悄悄」调外网、也不会产生费用。
// 4) 每次真实调用都记账（当日/当月调用数与 token），超过每日上限直接 429。
// 5) 任何一步失败都降级：至少返回从网页抓到的标题/描述/主色，不让 AI 故障阻断补全。
//
// 为什么密钥不能放前端：后台打包产物是公开静态文件，写进前端等于公开密钥。

import { json, bad, readJson } from '../lib/http';
import { requireRole } from './admin';
import { getSecret } from '../lib/secret';
import { encryptSecret, decryptSecret } from './webdav';
import type { Env } from '../lib/schema';

const CFG_KEY = 'ai_cfg';
const USAGE_KEY = 'ai_usage';

type AiCfg = {
  /** 走哪种通道：openai = 任何 OpenAI 兼容的 HTTP 服务；cf = 本站 Cloudflare Workers AI 绑定（免密钥、不走外网） */
  provider: 'openai' | 'cf';
  /** 用户开关（勾上才允许调用；没填密钥时即使勾着也视为关闭） */
  enabled: boolean;
  /** OpenAI 兼容的 base url，例如 https://api.deepseek.com/v1（末尾斜杠会自动去掉） */
  base_url: string;
  model: string;
  /** 密文（enc: 前缀）或历史明文 */
  key: string;
  /** 每日调用上限，防账单失控 */
  daily_limit: number;
};

const DEFAULT_CFG: AiCfg = {
  provider: 'openai',
  enabled: true,
  base_url: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  key: '',
  daily_limit: 50,
};

/** Workers AI 的默认模型：指令跟随和 JSON 稳定性比 8b 好一档，单价仍然很低 */
const CF_DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/** 当前配置在这台部署上到底能不能用：cf 通道要看有没有 AI 绑定，openai 通道要看有没有密钥 */
function ready(env: Env, cfg: AiCfg): boolean {
  return cfg.provider === 'cf' ? !!env.AI : !!cfg.key;
}

/* ---------------- 配置读写 ---------------- */

async function loadCfg(env: Env): Promise<AiCfg> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(CFG_KEY).first<{ value: string }>();
  const merged = { ...DEFAULT_CFG };
  if (row?.value) {
    try {
      const saved = JSON.parse(row.value) as Partial<AiCfg>;
      if (saved.provider === 'cf' || saved.provider === 'openai') merged.provider = saved.provider;
      if (typeof saved.enabled === 'boolean') merged.enabled = saved.enabled;
      if (typeof saved.base_url === 'string' && saved.base_url.trim()) merged.base_url = saved.base_url.trim();
      if (typeof saved.model === 'string' && saved.model.trim()) merged.model = saved.model.trim();
      if (typeof saved.key === 'string') merged.key = saved.key;
      if (Number(saved.daily_limit) > 0) merged.daily_limit = Math.min(1000, Math.round(Number(saved.daily_limit)));
    } catch { /* 配置坏了就用默认值，不要让整页 500 */ }
  }
  if (merged.key) merged.key = await decryptSecret(merged.key, await getSecret(env));
  return merged;
}

/** 落库：密钥只存密文（明文只存在于这一次请求的内存里） */
async function persistCfg(env: Env, cfg: AiCfg): Promise<void> {
  const secret = await getSecret(env);
  const stored: AiCfg = { ...cfg, key: cfg.key ? await encryptSecret(cfg.key, secret) : '' };
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(CFG_KEY, JSON.stringify(stored), Date.now())
    .run();
}

/* ---------------- 用量记账 ---------------- */

type Usage = { day: string; calls: number; tokens: number; month: string; mcalls: number; mtokens: number };

/** 按北京时间算「今天 / 本月」——用户在国内，账单和上限都按他的自然日算才符合直觉 */
function bjStamp(): { day: string; month: string } {
  const t = new Date(Date.now() + 8 * 3600 * 1000);
  const day = t.toISOString().slice(0, 10);
  return { day, month: day.slice(0, 7) };
}

async function loadUsage(env: Env): Promise<Usage> {
  const { day, month } = bjStamp();
  const empty: Usage = { day, calls: 0, tokens: 0, month, mcalls: 0, mtokens: 0 };
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(USAGE_KEY).first<{ value: string }>();
  if (!row?.value) return empty;
  try {
    const u = JSON.parse(row.value) as Partial<Usage>;
    /* 跨天/跨月自动归零：只保留当前周期的计数，历史不留（不做统计报表，省一张表） */
    return {
      day,
      calls: u.day === day ? Number(u.calls) || 0 : 0,
      tokens: u.day === day ? Number(u.tokens) || 0 : 0,
      month,
      mcalls: u.month === month ? Number(u.mcalls) || 0 : 0,
      mtokens: u.month === month ? Number(u.mtokens) || 0 : 0,
    };
  } catch {
    return empty;
  }
}

async function bumpUsage(env: Env, tokens: number): Promise<void> {
  const u = await loadUsage(env);
  const next: Usage = {
    day: u.day,
    calls: u.calls + 1,
    tokens: u.tokens + Math.max(0, tokens | 0),
    month: u.month,
    mcalls: u.mcalls + 1,
    mtokens: u.mtokens + Math.max(0, tokens | 0),
  };
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(USAGE_KEY, JSON.stringify(next), Date.now())
    .run();
}

/* ---------------- 对外视图 ---------------- */

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 3) + '••••' + key.slice(-4);
}

function view(cfg: AiCfg, usage: Usage, hasAI = false) {
  const configured = cfg.provider === 'cf' ? hasAI : !!cfg.key;
  return {
    provider: cfg.provider,
    ai_binding: hasAI,
    enabled: cfg.enabled && configured,
    switch_on: cfg.enabled,
    configured,
    base_url: cfg.base_url,
    model: cfg.model,
    daily_limit: cfg.daily_limit,
    key_hint: maskKey(cfg.key),
    usage: {
      day: usage.day,
      calls: usage.calls,
      tokens: usage.tokens,
      month: usage.month,
      month_calls: usage.mcalls,
      month_tokens: usage.mtokens,
      remaining: Math.max(0, cfg.daily_limit - usage.calls),
    },
  };
}

export async function aiInfo(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const cfg = await loadCfg(env);
  return json({ ok: true, ...view(cfg, await loadUsage(env), !!env.AI) });
}

export async function aiSave(env: Env, req: Request): Promise<Response> {
  /* 改密钥/换服务商属于账号级设置，只给 owner */
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const cur = await loadCfg(env);
  const next: AiCfg = { ...cur };

  if ('enabled' in body) next.enabled = !!body.enabled;
  if (body.provider === 'cf' || body.provider === 'openai') next.provider = body.provider;
  if (typeof body.base_url === 'string') {
    /* 完整 endpoint 也会被粘进来：落库前统一收成 base，界面回显就干净了 */
    const u = body.base_url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
    if (u && !/^https?:\/\/[^\s]+$/i.test(u)) return bad('接口地址要以 http:// 或 https:// 开头');
    next.base_url = u || DEFAULT_CFG.base_url;
  }
  if (typeof body.model === 'string' && body.model.trim()) next.model = body.model.trim();
  /* 内置通道只认 @cf/ 开头的模型名；切过来时别把 deepseek-chat 这种名字带过去 */
  if (next.provider === 'cf' && !/^@cf\//i.test(next.model)) next.model = CF_DEFAULT_MODEL;
  if (Number(body.daily_limit) > 0) next.daily_limit = Math.min(1000, Math.max(1, Math.round(Number(body.daily_limit))));

  /* 密钥三种语义：不传/空串 = 保持原值；'clear' = 清空；其他 = 覆盖 */
  if (typeof body.key === 'string') {
    const k = body.key.trim();
    if (k === 'clear') next.key = '';
    else if (k) next.key = k;
  }

  await persistCfg(env, next);
  return json({ ok: true, ...view(next, await loadUsage(env), !!env.AI) });
}

/* ---------------- 模型调用 ---------------- */

type ChatMsg = { role: 'system' | 'user'; content: string };

/**
 * 地址容错：用户既可能填到 /v1，也可能直接把文档里那条完整 endpoint 粘进来。
 * 早先无脑拼 /chat/completions，粘完整地址就会变成 …/chat/completions/chat/completions，
 * 上游网关对这种不存在的路径常直接回 429/1015（看着像限流，其实是路径错）。
 */
export function chatUrl(base: string): string {
  const u = String(base || '').trim().replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(u)) return u;
  return u + '/chat/completions';
}

async function callChat(env: Env, cfg: AiCfg, messages: ChatMsg[], maxTokens = 400): Promise<{ text: string; tokens: number }> {
  /* 通道二：Cloudflare Workers AI 绑定 —— 不发明文请求、不走公网，
     正好绕开「中转站对云服务器出口限流（1015）」这类问题，也不用密钥。 */
  if (cfg.provider === 'cf') {
    if (!env.AI) throw new Error('这台部署没有 AI 绑定：请确认 wrangler.toml 里有 [ai] binding = "AI" 且已重新部署');
    let r: any;
    try {
      r = await env.AI.run(cfg.model as any, { messages, max_tokens: maxTokens } as any);
    } catch (e: any) {
      throw new Error('Workers AI 调用失败：' + (e?.message || '未知错误'));
    }
    const text = String(r?.response ?? r?.choices?.[0]?.message?.content ?? '').trim();
    if (!text) throw new Error('Workers AI 没有返回内容（模型可能不支持对话格式）');
    const tokens = Number(r?.usage?.total_tokens) || 0;
    return { text, tokens };
  }

  const url = chatUrl(cfg.base_url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: 'Bearer ' + cfg.key,
        /* 不少中转站前面挂了 Cloudflare 并开了按 UA 的机器人规则；Worker 默认没 UA 容易被判成脚本 */
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(e?.name === 'AbortError' ? '模型响应超时（25 秒）' : '连接模型服务失败：' + (e?.message || '网络错误'));
  }
  clearTimeout(timer);

  const raw = await res.text();
  if (!res.ok) {
    /* 常见错因直接翻译成人话，省得用户对着 401/402 猜 */
    let detail = raw.slice(0, 200);
    try {
      const j = JSON.parse(raw);
      detail = j?.error?.message || j?.message || detail;
    } catch { /* 上游不是 JSON 就原样截断 */ }

    /* 上游挂 Cloudflare 时，429 往往不是「余额不足」，而是边缘风控 */
    const cf = /error\s*code\s*:?\s*(10\d\d)/i.exec(raw)?.[1] || '';
    if (cf === '1015') {
      throw new Error('上游 Cloudflare 边缘限流（1015）：这家中转站对来自云服务器的请求卡得比家用宽带紧，等 1~2 分钟再试；一直这样就换一家，或把接口地址改回 /v1 结尾再试：' + detail);
    }
    if (cf === '1020') {
      throw new Error('上游 Cloudflare 防火墙拒绝（1020）：这家中转站不允许云服务器直接调用，只能换服务商：' + detail);
    }

    const map: Record<number, string> = {
      401: '密钥无效或已过期',
      403: '密钥没有该模型的权限',
      404: '接口地址不对（多数服务商要带 /v1）',
      429: '模型服务限流或余额不足',
    };
    throw new Error((map[res.status] || `模型服务返回 ${res.status}`) + '：' + detail);
  }

  let data: any;
  try { data = JSON.parse(raw); } catch { throw new Error('模型返回的不是 JSON（接口地址可能指向了网页）'); }
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('模型没有返回内容');
  return { text, tokens: Number(data?.usage?.total_tokens) || 0 };
}

/** 模型爱把 JSON 包在 ```json 里，或者前后加一句解释 —— 这里只取第一个 { 到最后一个 } */
function parseLooseJson(text: string): any {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

export async function aiTest(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const cfg = await loadCfg(env);
  if (cfg.provider === 'cf') {
    if (!env.AI) return bad('这台部署没有 AI 绑定，请确认 wrangler.toml 里有 [ai] binding = "AI" 并已重新部署');
  } else if (!cfg.key) return bad('还没有填写 API 密钥');
  const t0 = Date.now();
  try {
    const r = await callChat(env, cfg, [
      { role: 'system', content: '你是一个连通性测试助手，只回复两个字符：OK' },
      { role: 'user', content: '测试' },
    ], 16);
    await bumpUsage(env, r.tokens);
    return json({ ok: true, reply: r.text.slice(0, 80), ms: Date.now() - t0, model: cfg.model, provider: cfg.provider, usage: view(cfg, await loadUsage(env), !!env.AI).usage });
  } catch (e: any) {
    return bad(e?.message || '测试失败', 502);
  }
}

/* ---------------- 网页信息抓取（不用 AI 也能用） ---------------- */

/** 明显是内网/本机的地址不抓：Worker 不该被当成内网探测工具 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]), b = Number(m[2]);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

type PageMeta = { title: string; description: string; color: string; host: string };

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function pickMeta(html: string, names: string[]): string {
  for (const n of names) {
    const re = new RegExp('<meta[^>]+(?:name|property)=["\']' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
    const tag = re.exec(html)?.[0];
    if (!tag) continue;
    const c = /content=["']([^"']*)["']/i.exec(tag)?.[1];
    if (c && c.trim()) return decodeEntities(c.trim());
  }
  return '';
}

async function fetchMeta(url: string): Promise<PageMeta> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let res: Response;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        /* 不少站点对非浏览器 UA 直接返回空壳/403，这里伪装成普通 Chrome */
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.6',
      },
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new Error(e?.name === 'AbortError' ? '网页打开超时（9 秒）' : '打不开这个网址：' + (e?.message || '网络错误'));
  }
  clearTimeout(timer);

  if (!res.ok) throw new Error('网页返回 ' + res.status + '（可能不允许外部抓取）');
  const type = res.headers.get('content-type') || '';
  if (!/html|xml|text/i.test(type)) throw new Error('这个地址不是网页（' + (type || '未知类型') + '）');

  /* 只读前 400KB：大页面没必要整份读，边缘内存省着点 */
  const buf = await res.arrayBuffer();
  const html = new TextDecoder('utf-8').decode(buf.slice(0, 400 * 1024));

  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '';
  const title = pickMeta(html, ['og:title', 'twitter:title']) || decodeEntities(titleTag.replace(/\s+/g, ' ').trim());
  const description = pickMeta(html, ['og:description', 'description', 'twitter:description']).replace(/\s+/g, ' ').slice(0, 200);
  const colorRaw = pickMeta(html, ['theme-color', 'msapplication-TileColor']);
  const color = /^#[0-9a-f]{6}$/i.test(colorRaw) ? colorRaw : '';

  let host = '';
  try { host = new URL(res.url || url).hostname; } catch { host = ''; }
  return { title, description, color, host };
}

/* ---------------- 图标名校验：AI 给的名字必须真的存在 ---------------- */

async function iconExists(name: string): Promise<boolean> {
  const m = /^([a-z0-9-]+):([a-z0-9-]+)$/i.exec(name);
  if (!m) return false;
  try {
    const r = await fetch(`https://api.iconify.design/${m[1]}/${m[2]}.svg?height=1`);
    /* 有些 CDN 对不存在的图标也回 200（空 body），两种都判 */
    if (!r.ok) return false;
    const body = await r.text();
    return body.includes('<svg');
  } catch {
    return false;
  }
}

async function searchIcon(keyword: string): Promise<string> {
  const q = keyword.replace(/[^\u4e00-\u9fa5a-zA-Z0-9 ]+/g, ' ').trim();
  if (!q) return '';
  /* 中文关键词在 Iconify 上常搜不到，按惯例优先用英文词；搜不到就直接放弃（留空走首字母色块） */
  try {
    const r = await fetch('https://api.iconify.design/search?query=' + encodeURIComponent(q) + '&limit=8');
    if (!r.ok) return '';
    const j: any = await r.json();
    const list: string[] = Array.isArray(j?.icons) ? j.icons : [];
    /* 优先挑常见图标集，形状风格更接近站点现有的线性图标 */
    const prefer = ['ri:', 'mdi:', 'material-symbols:', 'tabler:', 'ph:'];
    for (const p of prefer) {
      const hit = list.find((n) => n.startsWith(p));
      if (hit) return hit;
    }
    return list[0] || '';
  } catch {
    return '';
  }
}

/* ---------------- 补全 ---------------- */

export async function aiFill(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'editor');
  const body = await readJson(req);
  const rawUrl = String(body.url || '').trim();
  if (!rawUrl) return bad('请先填写网址');

  /* 没写协议的补 https://，与前台/扩展的规范化口径一致 */
  const full = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
  let parsed: URL;
  try { parsed = new URL(full); } catch { return bad('网址格式不对'); }
  if (!/^https?:$/.test(parsed.protocol)) return bad('只支持 http / https 网址');
  if (isPrivateHost(parsed.hostname)) return bad('内网或用本机地址不能抓取，请手填标题');

  const notes: string[] = [];
  let meta: PageMeta | null = null;
  try {
    meta = await fetchMeta(parsed.toString());
  } catch (e: any) {
    notes.push(e?.message || '网页信息抓取失败');
  }

  const cfg = await loadCfg(env);
  const canAi = cfg.enabled && ready(env, cfg);
  const usage = await loadUsage(env);

  /* 没有密钥 / 关了开关 / 今日超额 → 只回网页信息，不算失败 */
  if (!canAi) {
    notes.push(cfg.key ? 'AI 已关闭，只填入了网页自带信息' : '还没有配置 AI 模型，只填入了网页自带信息');
    return json({ ok: true, source: 'meta', notes, item: metaOnly(meta, parsed) });
  }
  if (usage.calls >= cfg.daily_limit) {
    notes.push(`今日 AI 调用已达上限（${cfg.daily_limit} 次），只填入了网页自带信息`);
    return json({ ok: true, source: 'meta', notes, item: metaOnly(meta, parsed) });
  }

  /* 分组候选：让模型只能在已有分组里挑，避免凭空造一个「工具」分组出来 */
  const groups = await env.DB.prepare('SELECT title FROM item_icon_group ORDER BY sort, id').all<{ title: string }>();
  const groupTitles = groups.results.map((g) => g.title).slice(0, 20);

  const prompt = [
    '你是书签整理助手。根据网址和网页信息补全一张导航卡片的字段。',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块。字段：',
    'title：卡片标题，2-6 个汉字（最多 8 字），要像人给网站起的简称，不要照抄整条网页标题；',
    'description：一句话说明，不超过 18 字，说清「这是干什么的」；',
    'icon：一个真实存在的 Iconify 图标名，形如 "ri:xxx" 或 "mdi:xxx"，必须与网站主题相关；',
    'color：该品牌/网站的代表色，#RRGGBB；',
    'group：从下面候选里原样挑一个最合适的，没有合适的就留空字符串。',
    '',
    '网址：' + parsed.toString(),
    '网页标题：' + (meta?.title || '（抓不到）'),
    '网页描述：' + (meta?.description || '（抓不到）'),
    '网页主题色：' + (meta?.color || '（没有）'),
    '分组候选：' + (groupTitles.length ? groupTitles.join('、') : '（暂无分组）'),
  ].join('\n');

  let raw: { text: string; tokens: number } | null = null;
  let aiItem: any = null;
  try {
    raw = await callChat(env, cfg, [
      { role: 'system', content: '你只输出严格 JSON。' },
      { role: 'user', content: prompt },
    ], 300);
    aiItem = parseLooseJson(raw.text);
    if (!aiItem) notes.push('模型返回的格式不对，已退回网页自带信息');
  } catch (e: any) {
    notes.push(e?.message || '模型调用失败');
  }
  if (raw) await bumpUsage(env, raw.tokens);

  const base = metaOnly(meta, parsed);
  if (!aiItem) return json({ ok: true, source: 'meta', notes, item: base });

  const title = String(aiItem.title || '').trim().slice(0, 20) || base.title;
  const description = String(aiItem.description || '').trim().slice(0, 100) || base.description;
  const color = /^#[0-9a-f]{6}$/i.test(String(aiItem.color || '')) ? String(aiItem.color) : base.color;

  /* 图标：先信模型给的名字，但必须真存在；不存在则拿模型给的名字当关键词去搜，再不行留空 */
  let iconName = String(aiItem.icon || '').trim();
  if (iconName && !(await iconExists(iconName))) {
    notes.push('模型给的图标名不存在，已改用关键词搜索');
    iconName = await searchIcon(iconName.replace(/^[a-z0-9-]+:/i, '').replace(/-/g, ' '));
  }

  const gTitle = String(aiItem.group || '').trim();
  const group = groupTitles.find((t) => t === gTitle) || '';

  return json({
    ok: true,
    source: 'ai',
    notes,
    item: { title, description, color, icon_name: iconName, group_title: group },
    usage: view(cfg, await loadUsage(env), !!env.AI).usage,
  });
}

/** 只靠网页自身信息拼出的一套字段（AI 不可用时的兜底） */
function metaOnly(meta: PageMeta | null, u: URL) {
  const host = meta?.host || u.hostname.replace(/^www\./, '');
  const fallbackTitle = host.split('.')[0] || u.hostname;
  const raw = (meta?.title || '').trim();
  /* 网页标题常带「- 官方网站」「| 首页」这类尾巴，取分隔符前的第一段通常就是站点名 */
  const first = raw.split(/\s+[-|–—]\s+|\s*[|｜]\s*/)[0].trim();
  const title = (first || fallbackTitle).slice(0, 20);
  const description = (meta?.description || '').replace(/^[，。\s]+/, '').slice(0, 100);
  return { title, description, color: meta?.color || '', icon_name: '', group_title: '' };
}
