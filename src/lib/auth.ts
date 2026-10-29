// 认证：PBKDF2-SHA256 口令哈希 + HS256 JWT + Cookie
//
// 为什么用 PBKDF2 而不是 bcrypt：
// Cloudflare Workers 免费档每次请求只有 10ms CPU，bcrypt 单次哈希就要 100ms+，
// 会直接触发 Error 1102（exceeded CPU time limit）。PBKDF2 用 15000 次迭代把开销压进预算。

const ITERATIONS = 15000;
const SALT_LEN = 16;
const KEY_LEN = 32;
const enc = new TextEncoder();
const dec = new TextDecoder();

export type Role = 'owner' | 'editor';
export type Session = { sub: number; username: string; role: Role; exp: number };

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function randomHex(bytes: number): string {
  return bufHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function bufHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function hexToBuf(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function hashPassword(password: string, saltHex: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBuf(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_LEN * 8,
  );
  return bufHex(new Uint8Array(bits));
}

export function userJson(passwordHash: string): string {
  return JSON.stringify({ iter: ITERATIONS, salt: randomHex(SALT_LEN), hash: passwordHash });
}

/** 校验口令；返回 {ok}。salt/hash 不存在时直接失败。 */
export async function verifyPassword(password: string, userJsonStr: string): Promise<boolean> {
  let meta: { iter?: number; salt?: string; hash?: string };
  try {
    meta = JSON.parse(userJsonStr);
  } catch {
    return false;
  }
  if (!meta.salt || !meta.hash) return false;
  const got = await hashPassword(password, meta.salt);
  return timingEq(got, meta.hash);
}

function timingEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- JWT (HS256) ---------------- */

function b64url(s: string): string {
  const bytes = enc.encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): string {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

export async function signToken(payload: Session, secret: string): Promise<string> {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(payload));
  const sig = bufHex(await hmac(secret, `${h}.${p}`));
  return `${h}.${p}.${sig}`;
}

export async function verifyToken(token: string, secret: string): Promise<Session | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  try {
    const expect = await hmac(secret, `${h}.${p}`);
    const got = hexToBuf(sig);
    if (expect.length !== got.length) return null;
    let diff = 0;
    for (let i = 0; i < expect.length; i++) diff |= expect[i] ^ got[i];
    if (diff !== 0) return null;
    const payload = JSON.parse(unb64url(p)) as Session;
    if (typeof payload.sub !== 'number' || typeof payload.exp !== 'number') return null;
    if (payload.exp <= nowSec()) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------------- Cookie ---------------- */

const COOKIE_NAME = 'sp_session';
const HOST_COOKIE = '__Host-sp_session';

/**
 * 生产环境（https）用 __Host- 前缀：要求 Secure + Path=/ + 无 Domain，
 * 把会话 Cookie 绑死到主机名，杜绝同站子域注入 Cookie 的攻击面。
 * 本地 http 开发无法设置 Secure，__Host- 会被浏览器拒收，故回退为无前缀名字。
 */
function cookieName(secure: boolean): string {
  return secure ? HOST_COOKIE : COOKIE_NAME;
}

export function setSessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  // 生产环境（https）用 SameSite=None; Secure：让会话 Cookie 能在「第三方上下文」里发送。
  // 典型场景——把本站嵌进浏览器扩展的新标签页（iframe 顶层是 extension://，本站请求对浏览器
  // 而言是第三方），SameSite=Lax 在第三方 iframe 中不会发送 Cookie，导致登录后 me/loadAll
  // 拿不到会话、几秒后退登。None 显式允许跨站发送，且不受第三方 Cookie 屏蔽影响。
  // 本地 http 无法设 Secure，None 必须配 Secure，故回退保持 Lax（同源本地开发无影响）。
  const sameSite = secure ? 'SameSite=None; Secure' : 'SameSite=Lax';
  const name = cookieName(secure);
  return `${name}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; ${sameSite}`;
}

/** 登出：同时清掉两个名字，兼容历史会话（旧部署写的是 sp_session） */
export function clearSessionCookie(): string[] {
  return [
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    `${HOST_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=None; Secure`,
  ];
}

/**
 * 仅清掉旧版遗留的 sp_session（不带 Secure/__Host- 前缀的名字）。
 * 登录成功后调用：把历史部署残留的失效 sp_session 清掉，浏览器里就只剩当前有效的
 * __Host-sp_session，readSessionCookie 不会再有「命中过期/失效遗留令牌」的歧义。
 * 注意不能清 __Host-sp_session —— 那是本次刚签发的、要留着用。
 */
export function clearLegacyCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  /* 旧版部署曾把会话写在 sp_session，新版在 https 上改用 __Host-sp_session。
     浏览器可能同时带着两个名字的 cookie。若直接返回第一个匹配，可能命中已过期/失效的
     legacy 令牌，让本该通过的请求误判 401（表现就是「登录成功却立刻登录已过期，一直登不进」）。
     这里取「未过期」的那个，且同有效时优先 __Host- 标准名。 */
  const valOf = (name: string): string | null => {
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
    }
    return null;
  };
  const host = valOf(HOST_COOKIE);
  const legacy = valOf(COOKIE_NAME);
  if (host && tokenAlive(host)) return host;
  if (legacy && tokenAlive(legacy)) return legacy;
  return host || legacy; // 都没有有效令牌时退化为优先 Host，与旧行为一致
}

/** 不验签，只快速判断 JWT 是否仍在有效期内（用于 cookie 二选一，避免拿到失效遗留令牌） */
function tokenAlive(token: string): boolean {
  try {
    const p = token.split('.')[1];
    if (!p) return false;
    const json = JSON.parse(unb64url(p)) as { exp?: number };
    return typeof json.exp === 'number' && json.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

/* ---------------- Cloudflare Access 校验 ---------------- */

/**
 * Access 已在边缘完成认证；这里对边缘传下来的 JWT 做真正的签名校验（RS256），
 * 仅在配置了 ACCESS_AUD 时启用。
 * 启用方式：Dashboard 给 Worker 绑定 Access 策略，把应用 AUD 填进 wrangler.toml 的
 * ACCESS_AUD；再把团队域名（如 yourteam.cloudflareaccess.com）填进 ACCESS_TEAM_DOMAIN，
 * 用于拉取验签公钥。只配 AUD 不配团队域时退化为仅校验 aud/exp（边缘已拦未授权请求）。
 */
let jwksCache: { domain: string; keys: any[]; at: number } | null = null;

async function getAccessJwks(teamDomain: string): Promise<any[]> {
  const now = Date.now();
  if (jwksCache && jwksCache.domain === teamDomain && now - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('无法获取 Access 公钥');
  const j = (await r.json()) as { keys?: any[] };
  const keys = j.keys || [];
  jwksCache = { domain: teamDomain, keys, at: now };
  return keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * 校验 Cf-Access-Jwt-Assertion 的 RS256 签名。
 * 配了团队域名就拉 JWKS 验签；没配则只校验 aud/exp（边缘已鉴权，这里做二次结构校验）。
 */
async function verifyAccessJwt(token: string, aud: string, teamDomain?: string): Promise<string | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; email?: string };
  try {
    header = JSON.parse(unb64url(h));
    payload = JSON.parse(unb64url(p));
  } catch {
    return null;
  }
  if (typeof payload.exp === 'number' && payload.exp <= nowSec()) return null;
  const audOk = Array.isArray(payload.aud) ? payload.aud.includes(aud) : payload.aud === aud;
  if (!audOk) return null;

  if (!teamDomain) return payload.email || null; // 未配团队域：跳过签名校验

  try {
    const keys = await getAccessJwks(teamDomain);
    const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk as any, { name: 'RSASSA-PKCS1-v1_5' }, false, ['verify']);
    const sigBytes = b64urlToBytes(sig);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
  } catch {
    return null;
  }
  return payload.email || null;
}

export async function readAccessIdentity(req: Request, aud?: string, teamDomain?: string): Promise<string | null> {
  if (!aud) return null;
  const header = req.headers.get('Cf-Access-Jwt-Assertion');
  const cookieRaw = req.headers.get('cookie') || '';
  const token =
    header ||
    (cookieRaw.split(';').find((p) => p.trim().startsWith('CF_Authorization=')) || '').split('=')[1] ||
    null;
  if (!token) return null;
  return verifyAccessJwt(token, aud, teamDomain);
}

/** Access 开启时（配了 ACCESS_AUD），/api/admin/* 必须由 Access 放行后带进来的身份才能访问。 */
export async function requireAccess(req: Request, aud?: string, teamDomain?: string): Promise<boolean> {
  if (!aud) return true;
  return (await readAccessIdentity(req, aud, teamDomain)) != null;
}
