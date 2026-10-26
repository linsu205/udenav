#!/usr/bin/env node
/**
 * 构建后台前端，并整理产物目录。
 *
 * 为什么需要这个脚本：
 *   以前 vite 的 outDir 直接就是 public/，为了不删掉 public/index.html 只能关掉
 *   emptyOutDir。结果每构建一次就多一个带新哈希的 admin.xxx.js / admin.xxx.css，
 *   旧文件永远没人清，几个月下来堆了十几 MB。
 *
 * 现在的做法：
 *   1. vite 只输出到 public/admin-assets/，output 前自动清空这个子目录
 *   2. 构建完把生成的 admin.html 提到 public/admin.html（/admin 路由读的就是它）
 *   3. 顺手清掉历史遗留的 public/assets/（仅当里面全是旧的构建产物时才动）
 *
 * 用法：npm run build
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'admin-assets');
const htmlOut = path.join(outDir, 'admin.html');
const htmlFinal = path.join(root, 'public', 'admin.html');
const legacyDir = path.join(root, 'public', 'assets');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const kb = n => (n / 1024).toFixed(0) + ' KB';
const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';

function fail(msg) {
  console.error('\n[build-admin] ' + msg);
  process.exit(1);
}

/* ---------- 1. vite 构建 ---------- */
console.log('[build-admin] vite build → public/admin-assets/');
const r = spawnSync(process.execPath, [viteBin, 'build', '--config', 'vite.config.ts'], {
  cwd: root,
  stdio: 'inherit',
});
if (r.status !== 0) fail('vite 构建失败（exit ' + r.status + '）');

if (!fs.existsSync(htmlOut)) fail('没有找到构建产物 admin.html，请检查 vite 的 rollupOptions.input');

/* ---------- 2. admin.html 提到 public/ 根目录 ---------- */
fs.copyFileSync(htmlOut, htmlFinal);
fs.rmSync(htmlOut);
console.log('[build-admin] public/admin.html 已更新');

/* ---------- 3. 清理历史遗留的 public/assets/ ---------- */
if (fs.existsSync(legacyDir)) {
  const files = fs.readdirSync(legacyDir, { withFileTypes: true });
  const isOldArtifact = f =>
    f.isFile() && /^(admin|vendor|index)\.[\w-]{8,}\.(js|css)$/.test(f.name);
  const allOld = files.every(isOldArtifact);
  if (files.length && allOld) {
    const bytes = files.reduce((s, f) => s + fs.statSync(path.join(legacyDir, f.name)).size, 0);
    fs.rmSync(legacyDir, { recursive: true, force: true });
    console.log(`[build-admin] 已删除旧的 public/assets/（${files.length} 个文件，${mb(bytes)}）`);
  } else if (files.length) {
    console.warn(
      '[build-admin] public/assets/ 里有不像构建产物的文件，已跳过，请手动确认：' +
        files.map(f => f.name).join(', '),
    );
  } else {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    console.log('[build-admin] 已删除空的 public/assets/');
  }
}

/* ---------- 4. 自检：admin.html 引用的文件必须都在 ---------- */
const html = fs.readFileSync(htmlFinal, 'utf8');
const refs = [...html.matchAll(/(?:src|href)="(\/admin-assets\/[^"]+)"/g)].map(m => m[1]);
if (!refs.length) fail('admin.html 里没有任何 /admin-assets/ 引用，base 配置可能不对');

const missing = refs.filter(u => !fs.existsSync(path.join(root, 'public', u.replace('/admin-assets/', 'admin-assets/'))));
if (missing.length) fail('admin.html 引用了不存在的文件：' + missing.join(', '));

/* ---------- 5. 报告 ---------- */
const kept = fs.readdirSync(outDir).map(n => {
  const size = fs.statSync(path.join(outDir, n)).size;
  return { n, size };
});
const total = kept.reduce((s, f) => s + f.size, 0);
console.log('\n[build-admin] 产物清单（' + kept.length + ' 个，共 ' + mb(total) + '）');
for (const f of kept.sort((a, b) => b.size - a.size)) console.log('  ' + f.n.padEnd(40) + kb(f.size));
console.log('[build-admin] 引用：' + refs.join('  '));
console.log('[build-admin] 完成。public/admin-assets/ 每次构建都会重建，不会再堆积旧文件。');
