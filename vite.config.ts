import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import { realpathSync } from 'node:fs';

// Vue3 admin 构建配置
// 输入：项目根目录的 admin.html（引用 ./admin-vue/src/main.ts）
// 输出：public/admin-assets/（整个目录每次构建清空重建，不会残留旧哈希文件）
//       构建完成后由 scripts/build-admin.mjs 把 admin.html 提到 public/admin.html
// 部署时 wrangler 会把 public/ 上传，访问 /admin 返回 admin.html

/* root 必须钉成磁盘真实大小写：从 Git Bash 启动构建时，node 的 process.cwd()
   盘符是小写（d:\File\udenav），而 vite 解析 import 时走 realpath 返回大写
   （D:\File\udenav）。root 与模块 id 大小写不一致时，html 内联 <style> 的
   proxy 缓存写入和查找对不上号，构建直接报
   「No matching HTML proxy module found from …?html-proxy&inline-css…」。
   Windows 文件系统大小写不敏感所以平时无感，这里显式统一掉。 */
const rootDir = realpathSync.native(__dirname);

export default defineConfig({
  root: rootDir,
  plugins: [vue()],
  // 资源前缀必须跟着产出目录走：/admin-assets/admin.[hash].js
  base: '/admin-assets/',
  // 关闭 publicDir 复制（输出目录就在 public/ 里面，避免自引用）
  publicDir: false,
  define: {
    /* 构建时间写进产物：「关于」页用它判断这份包比上游最新提交新还是旧。
       注意这个值每次构建都会变，所以重新构建必然产生新哈希 —— 这是预期行为。 */
    __ADMIN_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: resolve(rootDir, 'public/admin-assets'),
    // 只清空 admin-assets 这一个子目录，public/index.html 访客页不受影响
    emptyOutDir: true,
    rollupOptions: {
      input: { admin: resolve(rootDir, 'admin.html') },
      output: {
        // 目录本身已经是 admin-assets，文件名里不再重复一层 assets/
        entryFileNames: 'admin.[hash].js',
        chunkFileNames: '[name].[hash].js',
        assetFileNames: 'admin.[hash][extname]',
      },
    },
    assetsInlineLimit: 4096,
    target: 'es2022',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1500,
  },
});
