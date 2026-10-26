# 部署到 Cloudflare Workers（GitHub 自动部署）

和 NotePlus 一样的模式：代码推 GitHub → Cloudflare 自动拉取部署 → 不用手动跑命令。

**本项目只用 D1，不用 R2**——图标上传后作为 base64 存进 D1，备份走本地 JSON 导入/导出。所以 Cloudflare Deploy 按钮能一键完成，不用手动建 R2 桶。

## 免费档额度速查

| 服务 | 免费额度 | 本项目占用 |
|---|---|---|
| Workers 请求 | 10 万次/天 | 导航页 + 后台 API |
| Workers CPU | 10 ms/请求 | 已用 PBKDF2 + HS256，避开 bcrypt |
| D1 数据库 | 5 GB 总量 / 单库 500 MB / 500 万行读 | 数据量小，绰绰有余 |
| Static Assets | 2 万文件 / 25 MiB | 2 个 HTML 文件 |
| Access（可选） | 50 用户 | 后台入口再加一层 |

---

## 一、一次性准备（只做一次）

### 1. 在 Cloudflare 控制台创建资源

| 步骤 | 操作 | 位置 |
|---|---|---|
| ① 创建 Worker | Workers & Pages → Create Worker → 名字填 `udenav` | [Cloudflare Dashboard](https://dash.cloudflare.com) |
| ② 创建 D1 数据库 | Workers & Pages → D1 → Create → 名字填 `udenav-database` | 同上 |

> 只有两步，全在浏览器里点。

### 2. 在 Cloudflare 控制台设置密钥

进入 Worker `udenav` → **Settings → Variables & Secrets**：

| 名称 | 值 | 说明 |
|---|---|---|
| `SECRET` | 随便填 32 位以上随机字符串 | JWT 签名密钥，改了所有登录失效 |
| `SEED_DEMO` | `1` | 首启写示例数据（可省略，默认就是 1）|

生成随机密钥：

```bash
# Windows PowerShell
-join ((48..57) + (97..122) | Get-Random -Count 40 | % {[char]$_})
```

### 3. 把 Worker 关联到 D1

Worker → **Settings → Bindings**：

- 点 **Add → D1 Database** → 选 `udenav-database`，Binding 变量名填 `DB`

---

## 二、连接 GitHub 仓库（自动部署核心）

### 1. 把代码推到 GitHub

```bash
# 首次
cd udenav
git init
git add .
git commit -m "init: udenav"
git remote add origin https://github.com/你的用户名/udenav.git
git push -u origin main
```

> GitHub 仓库先在网页上建好（不要初始化 README），再 push。

### 2. 在 Cloudflare 连接仓库

Worker `udenav` → **Settings → Repository**：

1. 点 **Connect** → 选 GitHub → 授权 Cloudflare 访问仓库
2. 选仓库 `udenav`，分支 `main`
3. **Build command** 填：
   ```
   npm install
   ```
   （wrangler 自带 esbuild，不需要单独构建 TypeScript）
4. **Build output directory** 留空（wrangler.toml 指定了 main 和 assets）
5. 点 **Save and Deploy**

### 3. 之后每次改代码

```bash
git add .
git commit -m "update: xxx"
git push
```

Cloudflare 自动拉代码 → npm install → wrangler deploy → 上线。
整个过程约 1-2 分钟，不用手动跑任何命令。

---

## 三、本地开发

```bash
npm install
npx wrangler dev --local
```

- 访客页：http://127.0.0.1:8787/
- 后台：http://127.0.0.1:8787/admin

本地用 `.dev.vars` 里的 `SECRET`，数据存在 `.wrangler/` 目录（删了就是重置）。

---

## 四、备份

本项目**没有云端备份**（省掉 R2）。改法很简单：

1. 后台「备份与导入」→ **导出全部数据（JSON）**，把文件存到本地
2. 需要恢复时：后台「备份与导入」→ **导入 JSON** → 选那个文件

导出文件里包含：所有配置 / 分组 / 卡片（含图片 base64）/ 用户（不含密码哈希）。

建议每改一批配置就导出一次，备份文件名里带日期。

---

## 五、常用运维

| 操作 | 方法 |
|---|---|
| 看部署状态 | Cloudflare 控制台 → Worker → Deployments |
| 看日志 | Worker → Logs & Metrics |
| 看版本历史 | Worker → Deployments（可回滚）|
| 看当前环境变量 | Worker → Settings → Variables & Secrets |
| 重置密钥 | 改 SECRET → 保存 → 所有用户需重新登录 |

---

## 六、Cloudflare Access（可选，给后台加第二层门）

1. Cloudflare 控制台 → **Access → Applications → Add an Application**
2. 选 **Workers** → 选你的 Worker
3. 策略里加用户（GitHub / Google / 邮箱 OTP 都行）
4. 把 Access 应用的 **AUD** 填进 Worker 的 `ACCESS_AUD` 变量
5. 保存

开启后，访问 `/admin` 和 `/api/admin/*` 会先跳 Access 登录，再进你的后台登录。

---

## 七、免费档注意事项

1. **不要**用 bcrypt 做密码哈希 — 10 ms CPU 不够，会触发 Error 1102。本项目已用 PBKDF2-SHA256。
2. **不要**把 SECRET 写在 wrangler.toml — 放 Cloudflare 控制台的 Variables & Secrets 里。
3. **不要**在 wrangler.toml 里写 account_id / database_id — GitHub 自动部署不需要。
4. **不要**把 `.dev.vars` 推 GitHub — 已在 .gitignore 里排除。
5. **图标限制**：单张 ≤ 256KB（PNG/JPG/WebP/GIF/SVG），base64 内嵌进 D1 单条上限 2MB，留足余量。
