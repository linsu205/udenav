/// <reference types="vite/client" />

/** 构建时间（vite.config.ts 的 define 注入，ISO 字符串） */
declare const __ADMIN_BUILD__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
