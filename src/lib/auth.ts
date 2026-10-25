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

export function setSessionCookie(token: string, maxAgeSec: number, secure: boolean): string {
  const s = `${COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  return s;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export function readSessionCookie(req: Request): string | null {
  const raw = req.headers.get('cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

/* ---------------- Cloudflare Access 校验 ---------------- */

/**
 * Access 已在边缘完成认证；这里只读取它传下来的身份头，用于审计与二次校验。
 * 启用方式：Dashboard 给 Worker 的 workers.dev / 自定义域绑定 Access 策略，
 * 然后把 Access 应用的 AUD 填进 wrangler.toml 的 ACCESS_AUD。
 */
export function readAccessIdentity(req: Request, aud?: string): string | null {
  const header = req.headers.get('Cf-Access-Jwt-Assertion');
  const cookieRaw = req.headers.get('cookie') || '';
  const token = header || (cookieRaw.split(';').find((p) => p.trim().startsWith('CF_Authorization=')) || '').split('=')[1] || null;
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(unb64url(parts[1])) as { aud?: string | string[]; exp?: number; email?: string };
    if (typeof payload.exp === 'number' && payload.exp <= nowSec()) return null;
    if (aud && Array.isArray(payload.aud) && !payload.aud.includes(aud)) return null;
    return payload.email || null;
  } catch {
    return null;
  }
}

/** Access 开启时，/api/admin/* 必须由 Access 放行后带进来的身份才能访问。 */
export function requireAccess(req: Request, aud?: string): boolean {
  if (!aud) return true;
  return readAccessIdentity(req, aud) != null;
}
