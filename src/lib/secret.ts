// 自动 SECRET 管理：
//   1) 如果 Cloudflare 环境变量 SECRET 已配置（长度 ≥ 16），直接用它；
//   2) 否则查 D1 的 user_config 表 key='_secret' 读已持久化的密钥；
//   3) 都没有就随机生成一个 48 字节 base64url 密钥，写回 D1 持久化。
// 这样用户完全不用手动生成 SECRET，部署完就能登录。
// 注意：生成密钥会触发一次 D1 写入，只在冷启动首次发生，之后走内存缓存。

import { ensureSchema, type Env } from './schema';

const SECRET_KEY = '_secret';
let cached: string | null = null;

function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(48));
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < b.length; i += chunk) bin += String.fromCharCode(...b.subarray(i, i + chunk));
  return btoa(bin).replace(/[+/=]/g, '');
}

export async function getSecret(env: Env): Promise<string> {
  if (cached) return cached;
  const fromEnv = env.SECRET || '';
  if (fromEnv.length >= 16) {
    cached = fromEnv;
    return cached;
  }
  await ensureSchema(env.DB);
  const row = await env.DB.prepare('SELECT value FROM user_config WHERE key = ?').bind(SECRET_KEY).first<{ value: string }>();
  if (row && row.value.length >= 16) {
    cached = row.value;
    return cached;
  }
  const secret = randomSecret();
  await env.DB
    .prepare('INSERT INTO user_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(SECRET_KEY, secret, Date.now())
    .run();
  cached = secret;
  console.log('[secret] 未检测到环境变量 SECRET，已自动生成并持久化到 D1（user_config._secret）');
  return cached;
}

/** 测试 / 手动清理：仅在需要强制重新生成密钥时调用（例如怀疑密钥泄露） */
export function clearSecretCache(): void {
  cached = null;
}
