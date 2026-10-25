// 进程内一次性建表：避免每个请求都跑 schema 检查

import { ensureSchema, type Env } from './schema';

let kicked: Promise<void> | null = null;

export function ensureSchemaOnce(env: Env): Promise<void> {
  if (!kicked) kicked = ensureSchema(env.DB);
  return kicked;
}
