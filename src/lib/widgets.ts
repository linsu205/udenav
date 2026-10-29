/**
 * 内置组件（日历 / 备忘录 / 待办 / 换算器）的元数据。
 *
 * 为什么放在后端：图标、功能开关这些东西，前台（public/index.html 的
 * 纯 JS 渲染）和后台（admin-vue 的组件管理页）都要用；各写一份必然漂移
 * （以前登录页 logo 就踩过：改了一处忘了另一处）。所以只在这里定义一次，
 * 两边都从 GET /api/public/widget-meta 取。
 *
 * 图标路径是 24×24 网格里的**内部标记**（不含 <svg> 外壳），
 * 前端用 svgOf() / v-html 塞进 viewBox="0 0 24 24" 的 svg 里，
 * 颜色统一走 currentColor，深浅主题都自适应。
 */

/** 图标库里的一个图标：每种组件默认用一个，用户也能在「组件管理」里换成别的。
 *  dual / line / solid 是同一图形的三种风格（双色调 / 线框 / 实心），都走 currentColor，
 *  颜色由组件主色 --wc 决定，深浅主题自适应。内部标记不含 <svg> 外壳。 */
export type LibIcon = {
  key: string;
  label: string;
  dual: string;
  line: string;
  solid: string;
};

/** 风格：双色调 / 线框 / 实心。key 存进 item_icon.w_cfg.variant */
export type WidgetVariant = { key: 'dual' | 'line' | 'solid'; label: string };

/** 一个功能开关：存进 w_cfg.opts[key]，1 开 0 关（数据库里只存 0/1，便于比较） */
export type WidgetToggle = {
  key: string;
  label: string;
  hint: string;
  def: 0 | 1;
};

/** 一个预设图标：内置的（自带双色调/线框/实心三风格）或在线图标（Iconify 名称）。
 *  组件管理里那排快捷按钮就按这个渲染，用户也能直接填任意 Iconify 名称。 */
export type WidgetPreset =
  | { type: 'builtin'; variant: 'dual' | 'line' | 'solid'; label: string }
  | { type: 'iconify'; name: string; label: string };

export type WidgetKindMeta = {
  kind: 'calendar' | 'memo' | 'todo' | 'conv';
  label: string;
  desc: string;
  /** 该组件默认用的图标：图标库 key（cal/memo/todo）或 Iconify 名称（带冒号），用户可在组件管理里换成别的 */
  icon: string;
  /** 默认风格：不指定时按这个画（如待办默认实心）。不写回退 dual */
  defVariant?: 'dual' | 'line' | 'solid';
  /** 该组件的预设图标：内置三种风格 + 一个彩色在线图标 */
  presets: WidgetPreset[];
  toggles: WidgetToggle[];
};

/** 组件默认主色 = 项目 logo 的蓝（与后台 --sp-accent 同一值，改这里要一起改 theme.css） */
export const WIDGET_DEFAULT_COLOR = '#409EFF';

/* 描边属性串：线框/实心变体里共用，避免同一条属性写多遍后改漏 */
const FRAME = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"';
/* 反白色：画在实心色块**内部**的细节，必须真的白，不能跟随 currentColor
   （跟随就成了同色叠同色，细节全糊掉）。只出现在 solid 变体里。 */
const ON_SOLID = '#fff';

/* 图标库：所有组件图标都在这里定义一次（dual / line / solid 三种风格）。
   前台渲染与后台「组件管理」的图标选择器共用这一份，加新图标只改这里。
   每个图标都落在 24×24 网格、统一走 currentColor，颜色由组件主色 --wc 决定。 */
export const ICON_LIBRARY: LibIcon[] = [
  {
    key: 'cal', label: '日历',
    dual:
      '<rect x="3" y="4.2" width="18" height="16.6" rx="3.9" fill-opacity=".2"/>' +
      '<path d="M6.9 4.2h10.2a3.9 3.9 0 0 1 3.9 3.9v1.4H3V8.1a3.9 3.9 0 0 1 3.9-3.9Z"/>' +
      `<rect x="3" y="4.2" width="18" height="16.6" rx="3.9" ${FRAME}/>` +
      '<rect x="7.15" y="1.9" width="2" height="5.2" rx="1"/>' +
      '<rect x="14.85" y="1.9" width="2" height="5.2" rx="1"/>' +
      '<circle cx="8" cy="15.1" r="1.3"/><circle cx="12" cy="15.1" r="1.3"/><circle cx="16" cy="15.1" r="1.3"/>',
    line:
      `<rect x="3" y="4.2" width="18" height="16.6" rx="3.9" ${FRAME}/>` +
      '<path d="M3.4 8.9h17.2" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M8.15 2.2v3.7M15.85 2.2v3.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
      '<circle cx="8" cy="15.3" r="1.15"/><circle cx="12" cy="15.3" r="1.15"/><circle cx="16" cy="15.3" r="1.15"/>',
    solid:
      '<rect x="7.2" y="1.8" width="2.1" height="4.6" rx="1.05"/>' +
      '<rect x="14.7" y="1.8" width="2.1" height="4.6" rx="1.05"/>' +
      '<rect x="2.6" y="3.7" width="18.8" height="17.5" rx="4.6"/>' +
      `<rect x="5" y="10.3" width="14" height="1.7" rx=".85" fill="${ON_SOLID}" opacity=".92"/>` +
      `<circle cx="8" cy="15.4" r="1.25" fill="${ON_SOLID}"/><circle cx="12" cy="15.4" r="1.25" fill="${ON_SOLID}"/><circle cx="16" cy="15.4" r="1.25" fill="${ON_SOLID}"/>`,
  },
  {
    key: 'memo', label: '备忘录',
    dual:
      '<path d="M7.4 2.3h6.2c.4 0 .8.2 1.1.5l5.1 5.1c.3.3.5.7.5 1.1v8.5a4.2 4.2 0 0 1-4.2 4.2H7.4a4.2 4.2 0 0 1-4.2-4.2V6.5a4.2 4.2 0 0 1 4.2-4.2Z" fill-opacity=".2"/>' +
      '<path d="M14.7 2.8v4.3c0 .5.4.9.9.9h4.2Z"/>' +
      `<path d="M7.4 2.3h6.2c.4 0 .8.2 1.1.5l5.1 5.1c.3.3.5.7.5 1.1v8.5a4.2 4.2 0 0 1-4.2 4.2H7.4a4.2 4.2 0 0 1-4.2-4.2V6.5a4.2 4.2 0 0 1 4.2-4.2Z" ${FRAME}/>` +
      '<rect x="6.8" y="12.7" width="10.4" height="2.2" rx="1.1"/>' +
      '<rect x="6.8" y="16.9" width="7.2" height="2.2" rx="1.1"/>',
    line:
      `<path d="M7.4 2.3h6.2c.4 0 .8.2 1.1.5l5.1 5.1c.3.3.5.7.5 1.1v8.5a4.2 4.2 0 0 1-4.2 4.2H7.4a4.2 4.2 0 0 1-4.2-4.2V6.5a4.2 4.2 0 0 1 4.2-4.2Z" ${FRAME}/>` +
      '<path d="M13.9 2.6v4.9c0 .7.6 1.3 1.3 1.3h4.9" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M7.7 13.4h8.2M7.7 17h5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    solid:
      '<path d="M7.4 2.3h6.2c.4 0 .8.2 1.1.5l5.1 5.1c.3.3.5.7.5 1.1v8.5a4.2 4.2 0 0 1-4.2 4.2H7.4a4.2 4.2 0 0 1-4.2-4.2V6.5a4.2 4.2 0 0 1 4.2-4.2Z"/>' +
      `<path d="M13.9 2.6v4.9c0 .7.6 1.3 1.3 1.3h4.9" fill="none" stroke="${ON_SOLID}" stroke-width="1.6" opacity=".85"/>` +
      `<rect x="6.9" y="12.8" width="10.2" height="2.2" rx="1.1" fill="${ON_SOLID}"/>` +
      `<rect x="6.9" y="16.9" width="7" height="2.2" rx="1.1" fill="${ON_SOLID}"/>`,
  },
  {
    key: 'todo', label: '待办',
    dual:
      '<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" fill-opacity=".2"/>' +
      `<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" ${FRAME}/>` +
      '<path d="M7.4 12 10.8 15.4 17.1 8.9" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    line:
      `<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" ${FRAME}/>` +
      '<path d="M7.4 12 10.8 15.4 17.1 8.9" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    solid:
      '<rect x="3" y="3.3" width="18" height="17.4" rx="4.4"/>' +
      `<path d="M7.4 12 10.8 15.4 17.1 8.9" fill="none" stroke="${ON_SOLID}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    key: 'conv', label: '换算器',
    /* 双向箭头（上→右、下→左）：单位换算的通用符号，比天平/计算器都更贴「换算」本身 */
    dual:
      '<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" fill-opacity=".2"/>' +
      `<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" ${FRAME}/>` +
      '<path d="M6.8 9h9.9m0 0-2.6-2.6M16.7 9l-2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17.2 15H7.3m0 0 2.6-2.6M7.3 15l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    line:
      `<rect x="3" y="3.3" width="18" height="17.4" rx="4.4" ${FRAME}/>` +
      '<path d="M6.8 9h9.9m0 0-2.6-2.6M16.7 9l-2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M17.2 15H7.3m0 0 2.6-2.6M7.3 15l2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
    solid:
      '<rect x="3" y="3.3" width="18" height="17.4" rx="4.4"/>' +
      `<path d="M6.8 9h9.9m0 0-2.6-2.6M16.7 9l-2.6 2.6" fill="none" stroke="${ON_SOLID}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M17.2 15H7.3m0 0 2.6-2.6M7.3 15l2.6 2.6" fill="none" stroke="${ON_SOLID}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
];

export const WIDGET_VARIANTS: WidgetVariant[] = [
  { key: 'dual', label: '双色调' },
  { key: 'line', label: '线框' },
  { key: 'solid', label: '实心' },
];

/** 按 key 取图标库里的图标定义；查不到回退到日历 */
export function libIcon(name: string): LibIcon | undefined {
  return ICON_LIBRARY.find((i) => i.key === name);
}

/* 在线图标名：iconify 的「前缀:名称」，如 flat-color-icons:calendar。
   这个值会被拼进 /api/icon?name=… 的查询串，所以必须严格限定字符集，
   不能让用户输入里带 & # 之类的东西改了请求本身。 */
const ICONIFY_RE = /^[a-z0-9-]+:[a-z0-9-]+$/;

/** 是否是合法的 Iconify 图标名（带冒号） */
export function isIconifyIcon(v: unknown): boolean {
  return ICONIFY_RE.test(String(v ?? '').trim());
}

export const WIDGET_KINDS: WidgetKindMeta[] = [
  {
    kind: 'calendar',
    label: '日历',
    desc: '公历 + 农历 + 二十四节气，可翻月',
    icon: 'flat-color-icons:calendar',
    presets: [
      { type: 'builtin', variant: 'dual', label: '双色调' },
      { type: 'builtin', variant: 'line', label: '线框' },
      { type: 'builtin', variant: 'solid', label: '实心' },
      { type: 'iconify', name: 'flat-color-icons:calendar', label: '彩色' },
    ],
    toggles: [
      { key: 'lunar', label: '农历与节气', hint: '日期下方显示农历、传统节日和二十四节气', def: 1 },
      { key: 'monFirst', label: '周一为一周起始', hint: '关闭后按周日开头排列（周日在前）', def: 1 },
    ],
  },
  {
    kind: 'memo',
    label: '备忘录',
    desc: '左侧列表 + 右侧编辑，边写边存',
    icon: 'twemoji:memo',
    presets: [
      { type: 'builtin', variant: 'dual', label: '双色调' },
      { type: 'builtin', variant: 'line', label: '线框' },
      { type: 'builtin', variant: 'solid', label: '实心' },
      { type: 'iconify', name: 'twemoji:memo', label: '彩色' },
    ],
    toggles: [
      { key: 'showTime', label: '显示编辑时间', hint: '列表与编辑区显示「最后编辑」时间', def: 1 },
      { key: 'newFirst', label: '新建的排在最上面', hint: '关闭后新建的备忘录追加到列表末尾', def: 1 },
    ],
  },
  {
    kind: 'todo',
    label: '待办',
    desc: '按今天 / 所有 / 待办事项归类，可勾选完成',
    /* 默认就是彩色图标（用户不用设置）：切回内置图标时风格走实心 */
    icon: 'thesvg-color:microsoft-todo',
    defVariant: 'solid',
    presets: [
      { type: 'builtin', variant: 'dual', label: '双色调' },
      { type: 'builtin', variant: 'line', label: '线框' },
      { type: 'builtin', variant: 'solid', label: '实心' },
      { type: 'iconify', name: 'thesvg-color:microsoft-todo', label: '彩色' },
    ],
    toggles: [
      { key: 'showWhen', label: '显示日期', hint: '每条任务右侧显示任务日期', def: 1 },
      { key: 'showCreated', label: '显示创建时间', hint: '每条任务下方显示创建时间', def: 1 },
      { key: 'doneToday', label: '「今天」含已完成', hint: '关闭后，今天视图只列未完成的任务', def: 0 },
    ],
  },
  {
    kind: 'conv',
    label: '换算器',
    desc: '计算器（含历史记录）+ 常用单位换算',
    icon: 'conv',
    /* 默认实心（蓝色方块 + 白色箭头，即用户习惯的样子） */
    defVariant: 'solid',
    presets: [
      { type: 'builtin', variant: 'dual', label: '双色调' },
      { type: 'builtin', variant: 'line', label: '线框' },
      { type: 'builtin', variant: 'solid', label: '实心' },
      { type: 'iconify', name: 'twemoji:scales', label: '彩色' },
    ],
    /* 换算器没有功能开关：分类/单位是数学常量，没有可配的行为 */
    toggles: [],
  },
];

export const WIDGET_KIND_KEYS = WIDGET_KINDS.map((k) => k.kind);

export function isWidgetKind(v: unknown): boolean {
  return WIDGET_KIND_KEYS.includes(String(v ?? '') as 'calendar');
}

export function widgetMeta(kind: string): WidgetKindMeta | undefined {
  return WIDGET_KINDS.find((k) => k.kind === kind);
}

/** 组件配置：item_icon.w_cfg 里存的 JSON */
export type WidgetCfg = {
  /** 图标库 key（形状），空 = 该组件默认的图标 */
  icon: string;
  /** 风格：dual / line / solid，空 = dual */
  variant: string;
  /** 主色，空 = WIDGET_DEFAULT_COLOR */
  color: string;
  /** 功能开关，只存 0/1 */
  opts: Record<string, number>;
};

export const EMPTY_WIDGET_CFG: WidgetCfg = { icon: '', variant: '', color: '', opts: {} };

const VARIANT_KEYS = ['dual', 'line', 'solid'] as const;

/**
 * 归一化一份组件配置：丢弃未知图标/未知开关、颜色只收 #rgb / #rrggbb。
 * 为什么要归一而不是原样存：这个 JSON 会直接进前台的 style 与 svg，
 * 颜色若放行任意字符串就能拼出 `red;background:url(...)` 这类注入；
 * 未知 key 也会越存越多，时间长了没人知道哪些还有效。
 */
export function normWidgetCfg(kind: string, raw: unknown): WidgetCfg {
  const meta = widgetMeta(kind);
  const out: WidgetCfg = { icon: '', variant: '', color: '', opts: {} };
  if (!meta) return out;

  let src: Record<string, unknown> = {};
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw || '{}') || {};
    } catch {
      src = {};
    }
  } else if (raw && typeof raw === 'object') {
    src = raw as Record<string, unknown>;
  }

  let icon = String(src.icon ?? '');
  let variant = String(src.variant ?? '');
  /* 兼容旧配置：旧版把风格（dual/line/solid）存进了 icon 字段，没有 variant 时
     把它挪到 variant，图标回退到该组件默认形状 */
  if (!variant && (VARIANT_KEYS as readonly string[]).includes(icon)) {
    variant = icon;
    icon = '';
  }
  /* icon 允许两种写法：内置图标 key（cal/memo/todo）或 Iconify 名称（带冒号）。
     其余一律丢弃 —— 这个值会进前台的 <img src>，放行任意串等于开放了任意地址。 */
  if (libIcon(icon) || (icon.length <= 64 && isIconifyIcon(icon))) out.icon = icon;
  if ((VARIANT_KEYS as readonly string[]).includes(variant)) out.variant = variant;

  const color = String(src.color ?? '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(color) || /^#[0-9a-fA-F]{6}$/.test(color)) out.color = color;

  const opts = (src.opts && typeof src.opts === 'object' ? src.opts : {}) as Record<string, unknown>;
  for (const t of meta.toggles) {
    if (Object.prototype.hasOwnProperty.call(opts, t.key)) out.opts[t.key] = opts[t.key] ? 1 : 0;
  }
  return out;
}

/** 序列化成入库字符串；空配置存空串，前台据此走默认值（少一层 JSON 解析） */
export function stringifyWidgetCfg(cfg: WidgetCfg): string {
  if (!cfg.icon && !cfg.variant && !cfg.color && !Object.keys(cfg.opts).length) return '';
  return JSON.stringify(cfg);
}

/** 解出一份配置最终要画的那段 SVG 内部标记（按图标库 + 风格）。
 *  选了 Iconify 在线图标时返回空串 —— 那种图标是彩色位图/矢量，走 <img> 而不是内联 SVG。 */
export function widgetPath(cfg: WidgetCfg, kind: string): string {
  if (isIconifyIcon(cfg.icon)) return '';
  const name = libIcon(cfg.icon) ? cfg.icon : widgetMeta(kind)?.icon || 'cal';
  const variant = (VARIANT_KEYS as readonly string[]).includes(cfg.variant) ? cfg.variant : 'dual';
  const ic = libIcon(name);
  return ic ? (ic[variant as 'dual'] || ic.dual) : '';
}

/** 有效开关值：库里的 0/1 优先，没配过用元数据默认值 */
export function widgetOpt(cfg: WidgetCfg, kind: string, key: string): number {
  const v = cfg.opts[key];
  if (v === 0 || v === 1) return v;
  const t = widgetMeta(kind)?.toggles.find((x) => x.key === key);
  return t ? t.def : 0;
}
