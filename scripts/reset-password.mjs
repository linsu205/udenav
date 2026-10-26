#!/usr/bin/env node
/**
 * 忘记密码时的离线重置工具。
 *
 * 原理：口令在库里只存 PBKDF2-SHA256 的哈希（15000 次迭代），不可逆。
 * 所以“找回”实际是“重设”——生成新的 salt + hash 直接写回 users 表。
 * 生成的 pass_meta 格式与 src/lib/auth.ts 完全一致（已离线比对验证）。
 *
 * 用法：
 *   npm run passwd                        重置 admin，随机生成新密码
 *   npm run passwd -- admin MyPass123456  指定账号和密码
 *   npm run passwd -- --sql               只打印 SQL，用于线上 Cloudflare D1 控制台
 *   npm run passwd -- --db <路径>         指定本地库文件（默认自动寻找）
 *
 * 只依赖 Node 内置模块，不联网、不装包。
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/* Windows 控制台默认是 GBK 代码页，中文会显示成乱码；仅在实际终端里切到 UTF-8 */
if (process.platform === 'win32' && process.stdout.isTTY) {
  try { require('node:child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch { /* 忽略 */ }
}

const ITERATIONS = 15000;
const KEY_LEN = 32;
const SALT_LEN = 16;

/* ---------------- 参数解析 ---------------- */

const argv = process.argv.slice(2);
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`
忘记密码时重置管理后台账号

  npm run passwd                          重置 admin，自动生成随机密码
  npm run passwd -- admin 新密码          指定账号和密码
  npm run passwd -- --sql                 只打印 SQL（用于线上 D1 控制台）
  npm run passwd -- --db <文件>           指定本地数据库文件

说明：口令只以 PBKDF2 哈希存储，无法“找回”，只能重设。
     重置同时会清零 failed_login / lock_until，解除 30 分钟锁定。
`);
  process.exit(0);
}

const sqlOnly = argv.includes('--sql');
const dbIdx = argv.indexOf('--db');
const dbPath = dbIdx >= 0 ? argv[dbIdx + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && !(dbIdx >= 0 && i === dbIdx + 1));

const username = positional[0] || 'admin';
let password = positional[1] || '';

if (!password) {
  password = genPassword();
  console.log('未指定密码，已随机生成一个。');
}
if (password.length < 8) {
  console.error('密码至少 8 位。');
  process.exit(1);
}

/* ---------------- 口令处理 ---------------- */

function genPassword() {
  // 去掉 0/O/1/l/I 等易混字符，方便手抄
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += abc[b[i] % abc.length];
  return out;
}

const salt = randomBytes(SALT_LEN).toString('hex');
const hash = pbkdf2Sync(password, Buffer.from(salt, 'hex'), ITERATIONS, KEY_LEN, 'sha256').toString('hex');
const passMeta = JSON.stringify({ iter: ITERATIONS, salt, hash });

/* ---------------- 定位本地数据库 ---------------- */

function findLocalDb() {
  if (dbPath) {
    if (!existsSync(dbPath)) throw new Error(`指定的数据库不存在：${dbPath}`);
    return resolve(dbPath);
  }
  const base = join(ROOT, '.wrangler');
  if (!existsSync(base)) throw new Error('没有找到 .wrangler 目录（本地还没启动过 wrangler dev？）');

  const { DatabaseSync: DB } = requireSqlite();
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.sqlite') && e.name !== 'metadata.sqlite') files.push(p);
    }
  };
  walk(base);

  // 多个 state 目录时，取“含 users 表且最近被修改”的那一个
  let best = null;
  for (const f of files) {
    try {
      const db = new DB(f, { readOnly: true });
      const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
      db.close();
      if (!has) continue;
      const mtime = statSync(f).mtimeMs;
      const size = statSync(f).size;
      if (!best || mtime > best.mtime || (mtime === best.mtime && size > best.size)) {
        best = { file: f, mtime, size };
      }
    } catch { /* 跳过无法打开的文件 */ }
  }
  if (!best) throw new Error('.wrangler 下没有找到含 users 表的数据库文件');
  return best.file;
}

let DatabaseSync = null;
function requireSqlite() {
  if (!DatabaseSync) {
    // Node 22.5+ 内置；旧版本这里会抛错，走 --sql 模式
    // 顺手屏蔽 SQLite 的 ExperimentalWarning，避免刷屏
    const saved = process.listeners('warning');
    process.removeAllListeners('warning');
    process.on('warning', (w) => {
      if (!/ExperimentalWarning/.test(w.name)) console.warn(w.message);
    });
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (e) {
      saved.forEach((fn) => process.on('warning', fn));
      throw e;
    }
  }
  return { DatabaseSync };
}

/* ---------------- 执行 ---------------- */

const UPDATE_SQL =
  `UPDATE users SET pass_meta = '${passMeta.replace(/'/g, "''")}', failed_login = 0, lock_until = 0 WHERE username = '${username.replace(/'/g, "''")}';`;

console.log('');
console.log(`账号      : ${username}`);
console.log(`新密码    : ${password}`);
console.log('');

if (sqlOnly) {
  console.log('把下面这条 SQL 粘到 Cloudflare 控制台 → D1 → udenav-database → Console 执行：');
  console.log('');
  console.log(UPDATE_SQL);
  console.log('');
  console.log('（也可以在项目目录执行：npx wrangler d1 execute udenav-database --remote --command "<上面的 SQL>"）');
  console.log('');
  console.log('注意：这条 SQL 里是哈希，不是明文密码，但仍建议执行完就清掉终端记录。');
  process.exit(0);
}

let file;
try {
  file = findLocalDb();
} catch (e) {
  console.error(`定位本地数据库失败：${e.message}`);
  console.error('可以改用 --sql 模式，把 SQL 拿到线上去执行。');
  process.exit(1);
}

let changed = 0;
try {
  const { DatabaseSync: DB } = requireSqlite();
  const db = new DB(file);
  const row = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!row) {
    const all = db.prepare('SELECT username FROM users').all().map((r) => r.username);
    db.close();
    console.error(`本地库里没有账号 "${username}"。现有账号：${all.join(', ') || '（无）'}`);
    process.exit(1);
  }
  db.prepare('UPDATE users SET pass_meta = ?, failed_login = 0, lock_until = 0 WHERE username = ?').run(passMeta, username);
  changed = 1;
  db.close();
} catch (e) {
  console.error(`写入失败：${e.message}`);
  console.error('如果提示 node:sqlite 不可用，请用 --sql 模式。');
  process.exit(1);
}

console.log(`本地库    : ${file}`);
console.log(`结果      : 已重置 ${changed} 个账号，失败次数与锁定状态已清零`);
console.log('');
console.log('现在可以直接用上面的密码登录 /admin。');
console.log('改密码不会让已登录的浏览器掉线；需要的话在后台点退出即可。');
console.log('');
console.log('提醒：本地库和线上 D1 是两套数据。线上忘记密码要用 --sql 模式。');
