# UDeNav

Cloudflare Workers 导航页（GitHub 自动部署，**无需 R2**）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?repository=https%3A%2F%2Fgithub.com%2Flinsu205%2Fudenav)

---

## 功能

- 访客页：玻璃拟态 UI、时钟、搜索引擎切换、主题切换
- 后台：分组/卡片 CRUD、配置管理、图标上传、备份恢复、导入导出、统计
- 用户管理：后台直接改名 / 改密 / 解除登录锁定（最后一个账号不可删）
- 忘记密码：命令行一键重置（`npm run passwd`），本地与线上都支持
- 免费档：Workers + D1 + Static Assets，0 元（**图标 base64 内嵌 D1，不需要 R2 桶**）

## 快速部署（推荐，和 NotePlus 一样一键）

点上面的 **Deploy to Cloudflare** 按钮，**一次都不用再配置**：
1. 自动关联本仓库 `linsu205/udenav`（连接后每次 `git push` 自动构建部署）
2. 自动创建 D1 数据库 `udenav-database`
3. 自动读取 `package.json` 的 `npm run build` 作为构建命令
4. 自动部署上线

> 按这个按钮就够了，**不需要去控制台手动连仓库、改构建命令**。
> 如果你之前在控制台手动连过别的仓库（比如连成别的仓库），那是另一条连接线，
> 建议把那个旧的 Worker 删掉，避免混淆。

## 本地开发

```bash
npm install
npx wrangler dev --local
```

- 访客页：http://127.0.0.1:8787/
- 后台：http://127.0.0.1:8787/admin

改完后台前端要重新构建：

```bash
npm run build
```

- 产物在 `public/admin-assets/`，**每次构建整个目录清空重建**，不会留下旧哈希文件
- 脚本会把生成的 `admin.html` 提到 `public/admin.html`，`/admin` 路由读的就是它
- 旧的 `public/assets/` 已废弃；构建时若发现里面全是旧产物，会自动删掉
- 产物自检：构建结束会列出文件清单，并核对 `admin.html` 引用的文件是否都存在

## 部署（手动方式）

如果不使用 Deploy 按钮，需要手动创建资源：

1. Cloudflare 控制台创建 Worker `udenav`
2. 创建 D1 数据库 `udenav-database`
3. Worker 关联 D1（变量名 `DB`）
4. Worker Settings → Variables & Secrets → 加 `SECRET`（32 位以上随机串）
5. Worker Settings → Build → 连接 GitHub 仓库 `linsu205/udenav`（分支 main）
6. Build command 填 `npm run build`（部署命令 `npm run deploy`）
7. 之后每次 `git push` 自动部署

> ⚠️ 最容易踩的坑：第 5 步连的仓库必须和本地推送的仓库一致。
> 本项目推送 `linsu205/udenav`；若连成其它仓库，push 不会触发构建。

详细步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 忘记密码（命令行重置）

口令只以 PBKDF2-SHA256 哈希存在 D1 里，**不可逆**，所以只能「重设」，不能「找回」。
项目自带离线重置脚本 `scripts/reset-password.mjs`，只用 Node 内置模块，不联网、不用装包。

> 能登录时，改用户名 / 改密码直接去后台「用户管理」页即可；下面的命令行只用于**忘记密码**、或登录页都进不去的情况。

### 本地环境

在项目目录执行：

```bash
npm run passwd
```

- 默认重置 `admin`，随机生成 16 位新密码
- 随机密码已去掉 `0/O/1/l/I` 等易混字符，方便手抄
- 终端直接打印「账号 / 新密码 / 库文件路径」
- 自动在 `.wrangler` 下找含 `users` 表的库，不用手填路径

指定账号和密码：

```bash
npm run passwd -- admin MyPass123456
```

- 密码至少 8 位，不足会直接报错退出
- 找不到账号时，报错信息会列出库里现有的用户名

指定数据库文件（存在多个 `.wrangler` 状态目录时用）：

```bash
npm run passwd -- --db .wrangler/state/v3/d1/miniflare-D1DatabaseObject/xxxx.sqlite
```

> 本地模式依赖 Node ≥ 22.5（内置 `node:sqlite`）。版本太低会提示失败，改用下面的 `--sql` 模式。

### 线上环境（Cloudflare 已部署）

线上 D1 和本地库是**两套数据**，本地重置不影响线上。用 `--sql` 模式：

```bash
npm run passwd -- --sql
```

终端会输出一条 `UPDATE users SET pass_meta = ...`，两种执行方式任选一种：

- 方式一：Cloudflare 控制台 → Workers & Pages → D1 → `udenav-database` → Console，粘贴执行
- 方式二：本地命令行执行

```bash
npx wrangler d1 execute udenav-database --remote --command "<粘贴那条 SQL>"
```

> 这条 SQL 里是哈希不是明文密码，但执行完仍建议清掉终端记录。

### 补充说明

- 重置会同时清零 `failed_login` 与 `lock_until`，顺带解除 30 分钟登录锁定
- 改密码不会让已登录的浏览器掉线；需要的话在后台点退出
- 忘记用户名：随便传一个不存在的名字执行一次，报错里会列出全部账号

### 参数速查

| 命令 | 作用 |
| --- | --- |
| `npm run passwd` | 重置 admin，随机生成密码 |
| `npm run passwd -- <账号> <新密码>` | 指定账号和密码 |
| `npm run passwd -- --sql` | 只打印 SQL，用于线上 D1 |
| `npm run passwd -- --db <文件>` | 指定本地数据库文件 |
| `npm run passwd -- --help` | 查看帮助 |

## 技术栈

- TypeScript + Wrangler 4.152
- D1 (SQLite) — 用户/分组/卡片/配置/图标 base64
- WebCrypto — PBKDF2-SHA256 密码哈希 + HS256 JWT

## 免费档注意事项

1. **不要**用 bcrypt 做密码哈希 — 10 ms CPU 不够，会触发 Error 1102。本项目已用 PBKDF2-SHA256。
2. **不要**把 SECRET 写在 wrangler.toml — 放 Cloudflare 控制台的 Variables & Secrets 里。
3. **图标限制**：单张 ≤ 256KB（PNG/JPG/WebP/GIF/SVG），存为 base64 data URL 写入 D1。多张图标建议 < 30 张，避免 D1 单条 2MB 上限和冷启动读放大。
