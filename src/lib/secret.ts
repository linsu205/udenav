// 自动 SECRET 管理：
//   1) 如果 Cloudflare 环境变量 SECRET 已配置（长度 ≥ 16），直接用它；
//   2) 否则查 app_setting 表 key='_secret' 读已持久化的密钥；
//   3) 都没有就随机生成一个 48 字节 base64url 密钥，写回 app_setting 持久化。
// 这样用户完全不用手动生成 SECRET，部署完就能登录。
//
// 安全要点：密钥只存在环境变量或 app_setting（系统级设置表），**绝不进 user_config**。
// user_config 会被 /api/admin/export、WebDAV 备份整表导出，密钥若在里面就等于把 JWT 签名密钥
// 明文发给第三方备份盘 —— 这是审计发现的高危泄露面。app_setting 不参与任何导出，从根上消除。
//
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

  // 1) 优先读 app_setting（系统级，不随配置导出）
  const row = await env.DB.prepare('SELECT value FROM app_setting WHERE key = ?').bind(SECRET_KEY).first<{ value: string }>();
  if (row && row.value.length >= 16) {
    cached = row.value;
    return cached;
  }

  // 2) 迁移：旧版本可能把密钥存进了 user_config._secret，搬过来并清掉，避免漏进导出
  const oldRow = await env.DB.prepare('SELECT value FROM user_config WHERE key = ?').bind(SECRET_KEY).first<{ value: string }>();
  if (oldRow && oldRow.value.length >= 16) {
    await env.DB
      .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .bind(SECRET_KEY, oldRow.value, Date.now())
      .run();
    await env.DB.prepare('DELETE FROM user_config WHERE key = ?').bind(SECRET_KEY).run();
    cached = oldRow.value;
    console.log('[secret] 已从 user_config 迁移密钥到 app_setting');
    return cached;
  }

  // 3) 都没有：随机生成并持久化
  const secret = randomSecret();
  await env.DB
    .prepare('INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(SECRET_KEY, secret, Date.now())
    .run();
  cached = secret;
  console.log('[secret] 未检测到环境变量 SECRET，已自动生成并持久化到 app_setting（不随配置导出）');
  return cached;
}

/** 测试 / 手动清理：仅在需要强制重新生成密钥时调用（例如怀疑密钥泄露） */
export function clearSecretCache(): void {
  cached = null;
}
