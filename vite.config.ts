import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

// Vue3 admin 构建配置
// 输入：项目根目录的 admin.html（引用 ./admin-vue/src/main.ts）
// 输出：public/admin.html + public/assets/...
// 部署时 wrangler 会把 public/ 上传，访问 /admin 返回 admin.html
export default defineConfig({
  plugins: [vue()],
  base: '/',
  // 关闭 publicDir 复制（public/ 就是输出目录本身，避免自引用警告）
  publicDir: false,
  build: {
    outDir: resolve(__dirname, 'public'),
    emptyOutDir: false, // 保留 public/index.html 访客页
    rollupOptions: {
      input: { admin: resolve(__dirname, 'admin.html') },
      output: {
        entryFileNames: 'assets/admin.[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/admin.[hash][extname]',
      },
    },
    assetsInlineLimit: 4096,
    target: 'es2022',
    cssCodeSplit: false,
    chunkSizeWarningLimit: 1500,
  },
});
