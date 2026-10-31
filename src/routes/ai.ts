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
import { requireRole, fetchPage } from './admin';
import { getSecret } from '../lib/secret';
import { encryptSecret, decryptSecret } from './webdav';
import type { Env } from '../lib/schema';

const CFG_KEY = 'ai_cfg';
const USAGE_KEY = 'ai_usage';
/** 模型记录（多条）整体存成一个 blob，跟 ai_cfg 同表，不需要数据库迁移 */
const MODELS_KEY = 'ai_models';

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

/** 模型库里的一条记录：本质是一份「已保存的 AI 配置」，比 AiCfg 多备注名和创建时间 */
type AiModelRecord = {
  id: string;
  /** 备注名，如「DeepSeek·主用」；留空则列表里回退显示模型名 */
  name: string;
  provider: 'openai' | 'cf';
  base_url: string;
  model: string;
  /** 密文（enc: 前缀）；和历史明文兼容 */
  key: string;
  daily_limit: number;
  /** 这条记录自己的启停开关；老数据没有这个字段时按启用处理 */
  enabled: boolean;
  created_at: number;
};

type AiModelsBlob = { active_id: string; list: AiModelRecord[] };

/**
 * Workers AI 的默认模型。
 * 补全只是从页面元信息里抽「标题/描述/颜色/分组」几个字段，8B 足够，
 * 比 70B 快好几倍、更省额度。
 * 注意：非量化的 llama-3.1-8b-instruct 已被 Cloudflare 于 2026-05-30 废弃，
 * 现役的是 fp8 量化版 llama-3.1-8b-instruct-fp8，别再改回去。
 */
const CF_DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

/**
 * 已废弃/不再推荐的旧默认模型。存量部署里可能已落库，
 * 加载时自动迁移到当前默认，避免出现「连接失败：模型已废弃」。
 * 只迁移这些已知旧默认值，用户手动选的其它 @cf 模型不受影响。
 */
const DEPRECATED_CF_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast', // 老默认，偏慢
  '@cf/meta/llama-3.1-8b-instruct', // 2026-05-30 被 Cloudflare 废弃
  '@cf/meta/infire-llama-3.1-8b-instruct', // 2026-05-30 被 Cloudflare 废弃
];

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
  /* 存量部署若还停在已废弃/偏慢的旧默认模型，自动迁移到当前默认（用户手动选的其它 @cf 模型不受影响） */
  if (merged.provider === 'cf' && DEPRECATED_CF_MODELS.includes(merged.model)) merged.model = CF_DEFAULT_MODEL;
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

/* ---------------- 模型记录读写 ---------------- */

async function loadModels(env: Env): Promise<AiModelsBlob> {
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(MODELS_KEY).first<{ value: string }>();
  if (!row?.value) return { active_id: '', list: [] };
  try {
    const b = JSON.parse(row.value) as Partial<AiModelsBlob>;
    const secret = await getSecret(env);
    const list: AiModelRecord[] = Array.isArray(b.list)
      ? await Promise.all(
          b.list
            .filter((r: any) => r && typeof r.id === 'string' && r.id)
            .map(async (r: any): Promise<AiModelRecord> => ({
              id: String(r.id),
              name: typeof r.name === 'string' ? r.name.slice(0, 40) : '',
              provider: r.provider === 'cf' ? 'cf' : 'openai',
              base_url: typeof r.base_url === 'string' ? r.base_url : '',
              model: typeof r.model === 'string' ? r.model.slice(0, 120) : '',
              key: typeof r.key === 'string' && r.key ? await decryptSecret(r.key, secret) : '',
              daily_limit:
                Number(r.daily_limit) > 0 ? Math.min(1000, Math.round(Number(r.daily_limit))) : DEFAULT_CFG.daily_limit,
              enabled: r.enabled !== false,
              created_at: Number(r.created_at) || 0,
            })),
        )
      : [];
    /* active_id 指向的记录若已被删掉，就退回空，避免界面高亮一个不存在的条目 */
    const active_id = typeof b.active_id === 'string' && list.some((r) => r.id === b.active_id) ? b.active_id : '';
    return { active_id, list };
  } catch {
    return { active_id: '', list: [] };
  }
}

/** 落库：密钥只存密文 */
async function persistModels(env: Env, blob: AiModelsBlob): Promise<void> {
  const secret = await getSecret(env);
  const list = await Promise.all(
    blob.list.map(async (r) => ({ ...r, key: r.key ? await encryptSecret(r.key, secret) : '' })),
  );
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(MODELS_KEY, JSON.stringify({ active_id: blob.active_id, list }), Date.now())
    .run();
}

function newModelId(): string {
  return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/** 记录对外的形状：跟 view() 一致，密钥只给末四位 */
function recordView(r: AiModelRecord) {
  return {
    id: r.id,
    name: r.name || r.model,
    provider: r.provider,
    base_url: r.base_url,
    model: r.model,
    daily_limit: r.daily_limit,
    enabled: r.enabled !== false,
    key_hint: maskKey(r.key),
    created_at: r.created_at,
  };
}

function modelsView(blob: AiModelsBlob) {
  return { active_id: blob.active_id, list: blob.list.map(recordView) };
}

/** 把一条记录写成「当前生效配置」，调用点只认 ai_cfg，不用感知模型库的存在 */
async function activateRecord(env: Env, rec: AiModelRecord): Promise<void> {
  const cfg = await loadCfg(env);
  cfg.provider = rec.provider;
  cfg.base_url = rec.base_url;
  cfg.model = rec.model;
  cfg.key = rec.key;
  cfg.daily_limit = rec.daily_limit;
  cfg.enabled = rec.enabled;
  await persistCfg(env, cfg);
}

/** 记录的去重键：同「通道 + 地址 + 模型」视为同一条，反复保存不会堆出一堆重复记录 */
function modelKey(p: { provider: string; base_url: string; model: string }): string {
  return `${p.provider}|${p.base_url}|${p.model}`;
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
  const blob = await loadModels(env);
  return json({ ok: true, ...view(cfg, await loadUsage(env), !!env.AI), models: modelsView(blob) });
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
  /* 内置通道不发 HTTP 请求，地址留空，免得记录里挂着上一个服务商的地址 */
  if (next.provider === 'cf') next.base_url = '';
  if (Number(body.daily_limit) > 0) next.daily_limit = Math.min(1000, Math.max(1, Math.round(Number(body.daily_limit))));

  /* 密钥三种语义：不传/空串 = 保持原值；'clear' = 清空；其他 = 覆盖。
     「原值」以这次保存命中的那条记录为准，不要拿全局 ai_cfg 兜底 ——
     编辑别的记录时输入框必然是空的，拿 ai_cfg 兜底会把上一条记录的密钥覆盖过来。 */
  const keyRaw = typeof body.key === 'string' ? body.key.trim() : '';
  const wantClear = keyRaw === 'clear';
  const typedKey = keyRaw && !wantClear ? keyRaw : '';

  /* 保存即入模型库：给了 id 就更新那条，没给就按「通道 + 地址 + 模型」去重后新建 */
  const blob = await loadModels(env);
  const wantId = String(body.id || '').trim();
  let rec = wantId ? blob.list.find((r) => r.id === wantId) : undefined;
  if (!rec) rec = blob.list.find((r) => modelKey(r) === modelKey(next));
  if (rec) {
    /* 名称只在表单真的传了时才改：像「清除密钥」这种只带 key 的请求不能把备注名抹掉 */
    if (typeof body.name === 'string') rec.name = body.name.trim().slice(0, 40);
    rec.provider = next.provider;
    rec.base_url = next.base_url;
    rec.model = next.model;
    rec.daily_limit = next.daily_limit;
    rec.enabled = next.enabled;
    if (wantClear) rec.key = '';
    else if (typedKey) rec.key = typedKey;
    /* 都没给 = 保持这条记录原来的密钥 */
  } else {
    /* 新建一条：没填密钥时，只有「同一个接口地址」才继承当前密钥。
       换了服务商还把上家的密钥带过去，既不安全也必然调不通。 */
    const inherit = next.provider === 'cf' || next.base_url !== cur.base_url ? '' : cur.key;
    rec = {
      id: newModelId(),
      name: String(body.name || '').trim().slice(0, 40),
      provider: next.provider,
      base_url: next.base_url,
      model: next.model,
      key: wantClear ? '' : typedKey || inherit,
      daily_limit: next.daily_limit,
      enabled: next.enabled,
      created_at: Date.now(),
    };
    blob.list.push(rec);
  }
  blob.active_id = rec.id;

  /* 保存即生效：ai_cfg 与这条记录保持一致，aiFill / aiTest 等调用点不用感知模型库 */
  next.key = rec.key;
  await persistCfg(env, next);
  await persistModels(env, blob);
  return json({ ok: true, ...view(next, await loadUsage(env), !!env.AI), models: modelsView(blob) });
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
  const body = await readJson(req);
  let cfg = await loadCfg(env);
  /* 传了 id = 只测「模型记录」里那一条，不改动当前生效配置 ——
     列表每行的「测试」按钮走这条路；不传 id 时测的就是当前生效配置 */
  const testId = String(body?.id || '').trim();
  if (testId) {
    const blob = await loadModels(env);
    const rec = blob.list.find((r) => r.id === testId);
    if (!rec) return bad('记录不存在');
    cfg = { ...cfg, provider: rec.provider, base_url: rec.base_url, model: rec.model, key: rec.key };
  }
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

/* 网页元信息与图标候选解析已迁移到 admin.ts 的 fetchPage：一次抓取同时产出元信息与真实 favicon，避免页面被重复下载 */

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

/**
 * 把模型返回的「分组」归一到已有分组之一。
 * 模型常返回近似名（如「开发」对应「软件开发」、「影视」对应「娱乐影视」），
 * 纯相等会大量落空并退化到默认分组；这里做归一化 + 包含匹配，
 * 但绝不让模型凭空造一个分组出来。
 */
function matchGroupTitle(raw: string, candidates: string[]): string {
  const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase();
  const r = norm(raw);
  if (!r) return '';
  const cands = candidates.map((t) => ({ t, n: norm(t) }));
  /* 1) 归一化后完全相等 */
  const exact = cands.find((c) => c.n === r);
  if (exact) return exact.t;
  /* 2) 候选包含模型名（模型用短名指代长分组名，最常见）：取最短的候选，最贴近缩写。
     单字不做包含匹配，避免「网」误命中所有含「网」的分组 */
  if (r.length >= 2) {
    const contained = cands.filter((c) => c.n.includes(r));
    if (contained.length) return contained.sort((a, b) => a.n.length - b.n.length)[0].t;
    /* 3) 模型名包含候选（模型给了带后缀的全名）：取最长的候选 */
    const rev = cands.filter((c) => r.includes(c.n) && c.n.length > 0);
    if (rev.length) return rev.sort((a, b) => b.n.length - a.n.length)[0].t;
  }
  return '';
}

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
  /* 一次抓页：元信息 + 站点真实 favicon 一起拿回来（图标已按尺寸门槛过滤）。
     比「先 fetchMeta 再让模型猜 iconify 名」少一次页面下载，也根除了
     「模型猜的图标名不存在」这个主要错误源 */
  let meta: PageMeta | null = null;
  let faviconData: { dataUrl: string; bytes: number; contentType: string } | null = null;
  try {
    const page = await fetchPage(parsed.toString());
    meta = page.meta;
    faviconData = page.icon;
    if (page.error) notes.push(page.error);
  } catch (e: any) {
    notes.push(e?.message || '网页信息抓取失败');
  }

  /* 页面是否真的抓到：抓不到（DNS 不通 / 超时 / 拒绝连接 / 空响应）视为不可达。
     前端据此提醒「网址无法访问」，但仍照常返回降级结果，不阻断用户保存 */
  const reachable = !!meta;

  const cfg = await loadCfg(env);
  const canAi = cfg.enabled && ready(env, cfg);
  const usage = await loadUsage(env);

  /* 没有密钥 / 关了开关 / 今日超额 → 只回网页信息 + 真实图标，不算失败 */
  if (!canAi) {
    notes.push(cfg.key ? 'AI 已关闭，只填入了网页自带信息' : '还没有配置 AI 模型，只填入了网页自带信息');
    return json({ ok: true, source: 'meta', reachable, notes, item: metaOnly(meta, parsed, faviconData) });
  }
  if (usage.calls >= cfg.daily_limit) {
    notes.push(`今日 AI 调用已达上限（${cfg.daily_limit} 次），只填入了网页自带信息`);
    return json({ ok: true, source: 'meta', reachable, notes, item: metaOnly(meta, parsed, faviconData) });
  }

  /* 分组候选：让模型只能在已有分组里挑，避免凭空造一个「工具」分组出来 */
  const groups = await env.DB.prepare('SELECT title FROM item_icon_group ORDER BY sort, id').all<{ title: string }>();
  const groupTitles = groups.results.map((g) => g.title).slice(0, 20);

  const prompt = [
    '你是书签整理助手。根据网址和网页信息补全一张导航卡片的字段。',
    '只输出一个 JSON 对象，不要解释、不要 markdown 代码块。字段：',
    'title：卡片标题，2-6 个汉字（最多 8 字），要像人给网站起的简称，不要照抄整条网页标题；',
    'description：一句话说明，不超过 18 字，说清「这是干什么的」；',
    'color：该品牌/网站的代表色，#RRGGBB，没有就留空字符串；',
    'group：从下面候选里原样挑一个最合适的，没有合适的就留空字符串。',
    '注意：图标由系统单独抓取站点真实 favicon，你不需要、也不应该返回 icon 字段。',
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
    ], 150);
    aiItem = parseLooseJson(raw.text);
    if (!aiItem) notes.push('模型返回的格式不对，已退回网页自带信息');
  } catch (e: any) {
    notes.push(e?.message || '模型调用失败');
  }
  if (raw) await bumpUsage(env, raw.tokens);

  const base = metaOnly(meta, parsed, faviconData);
  if (!aiItem) return json({ ok: true, source: 'meta', reachable, notes, item: base });

  const title = String(aiItem.title || '').trim().slice(0, 20) || base.title;
  const description = String(aiItem.description || '').trim().slice(0, 100) || base.description;
  const color = /^#[0-9a-f]{6}$/i.test(String(aiItem.color || '')) ? String(aiItem.color) : base.color;

  /* 图标：优先用站点真实 favicon（fetchPage 已按尺寸门槛过滤过，太小的不要）；
     抓不到 / 太小才回退到模型给的 Iconify 名，并校验存在性、关键词兜底搜索 */
  let iconUrl = faviconData?.dataUrl || '';
  let iconName = '';
  if (!iconUrl && aiItem?.icon) {
    const nm = String(aiItem.icon || '').trim();
    if (nm && !(await iconExists(nm))) {
      notes.push('模型给的图标名不存在，已改用关键词搜索');
      iconName = await searchIcon(nm.replace(/^[a-z0-9-]+:/i, '').replace(/-/g, ' '));
    } else {
      iconName = nm;
    }
    if (!iconName) notes.push('没拿到可用图标，将显示标题首字母色块');
  } else if (iconUrl) {
    notes.push('已优先采用站点真实图标');
  } else {
    notes.push('没抓到站点图标，将显示标题首字母色块');
  }

  const gTitle = String(aiItem.group || '').trim();
  const group = matchGroupTitle(gTitle, groupTitles);

  return json({
    ok: true,
    source: 'ai',
    reachable,
    notes,
    item: { title, description, color, icon_url: iconUrl, icon_name: iconName, group_title: group },
    usage: view(cfg, await loadUsage(env), !!env.AI).usage,
  });
}

/** 只靠网页自身信息拼出的一套字段（AI 不可用时的兜底）；fav 为已抓到的真实站点图标 */
function metaOnly(meta: PageMeta | null, u: URL, fav?: { dataUrl: string } | null) {
  const host = meta?.host || u.hostname.replace(/^www\./, '');
  const fallbackTitle = host.split('.')[0] || u.hostname;
  const raw = (meta?.title || '').trim();
  /* 网页标题常带「- 官方网站」「| 首页」这类尾巴，取分隔符前的第一段通常就是站点名 */
  const first = raw.split(/\s+[-|–—]\s+|\s*[|｜]\s*/)[0].trim();
  const title = (first || fallbackTitle).slice(0, 20);
  const description = (meta?.description || '').replace(/^[，。\s]+/, '').slice(0, 100);
  return { title, description, color: meta?.color || '', icon_url: fav?.dataUrl || '', icon_name: '', group_title: '' };
}

/* ---------------- 模型记录（多条：切换 / 删除） ----------------
   库里始终只留一份「当前生效配置」ai_cfg，模型记录是额外的「我的模型库」。
   切换 = 把记录内容写回 ai_cfg，所以调用点（aiFill / aiTest）不用感知记录的存在。 */

/** 切换当前生效模型 */
export async function aiModelsActive(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const body = await readJson(req);
  const id = String(body.id || '').trim();
  const blob = await loadModels(env);
  const rec = blob.list.find((r) => r.id === id);
  if (!rec) return bad('记录不存在');
  blob.active_id = id;
  await persistModels(env, blob);
  await activateRecord(env, rec);
  return json({ ok: true, ...modelsView(blob) });
}

/** 删除一条记录；删掉的若是当前生效记录，只摘掉生效标记，ai_cfg 仍保持可用 */
export async function aiModelsDelete(env: Env, req: Request): Promise<Response> {
  await requireRole(req, env, 'owner');
  const id = String(new URL(req.url).searchParams.get('id') || '').trim();
  const blob = await loadModels(env);
  const next = blob.list.filter((r) => r.id !== id);
  if (next.length === blob.list.length) return bad('记录不存在');
  blob.list = next;
  if (blob.active_id === id) blob.active_id = '';
  await persistModels(env, blob);
  return json({ ok: true, ...modelsView(blob) });
}
