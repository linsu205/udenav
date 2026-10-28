// 版本与项目元信息：Worker 与后台前端共用一份，避免两边各写一个版本号。
//
// 版本号只有 package.json 一个来源 —— 改版本只改那里，后台「关于」页、
// 检查更新接口拿到的都是同一份数据。wrangler 打包时会把 JSON 内联进产物，
// 不会在运行时多读一次文件（Workers 也没有文件系统）。

import pkg from '../../package.json';

/** 应用版本（取自 package.json 的 version） */
export const APP_VERSION: string = ((pkg as { version?: string }).version || '0.0.0').trim();
/**
 * 展示用项目名。
 * 不用 package.json 的 name —— npm 包名按规范只能小写（udenav），
 * 而界面里要显示的是品牌写法 UDeNav，两者不是一回事。
 */
export const APP_NAME = 'UDeNav';

/** 上游仓库：检查更新用。仓库地址变了只改这两行 */
export const REPO_SLUG = 'linsu205/udenav';
export const APP_REPO = 'https://github.com/' + REPO_SLUG;

/** 与 wrangler.toml 的 compatibility_date 保持一致（改部署配置时同步改这里） */
export const COMPAT_DATE = '2026-09-01';
