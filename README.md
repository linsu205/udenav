# unav

Cloudflare Workers 导航页（GitHub 自动部署）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Flinsu205%2Funav)

---

## 功能

- 访客页：玻璃拟态 UI、时钟、搜索引擎切换、主题切换
- 后台：分组/卡片 CRUD、配置管理、图标上传、备份恢复、导入导出、统计
- 免费档：Workers + D1 + R2 + Static Assets，0 元

## 快速部署

点上面的 **Deploy to Cloudflare** 按钮，Cloudflare 自动：
1. 创建 GitHub 仓库
2. 创建 D1 数据库和 R2 桶
3. 配置 CI/CD
4. 部署上线

之后每次 `git push` 自动部署。

## 本地开发

```bash
npm install
npx wrangler dev --local
```

- 访客页：http://127.0.0.1:8787/
- 后台：http://127.0.0.1:8787/admin

## 部署（手动方式）

如果不使用 Deploy 按钮，需要手动创建资源：

1. Cloudflare 控制台创建 Worker `unav`
2. 创建 D1 数据库 `unav-database`
3. 创建 R2 桶 `unav-bucket`
4. Worker 关联 D1（变量名 `DB`）和 R2（变量名 `BUCKET`）
5. Worker Settings → Variables & Secrets → 加 `SECRET`（32 位以上随机串）
6. Worker Settings → Repository → 连接 GitHub 仓库
7. Build command 填 `npm install`
8. 之后每次 `git push` 自动部署

详细步骤见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 技术栈

- TypeScript + Wrangler 4.152
- D1 (SQLite) — 用户/分组/卡片/配置
- R2 — 图标上传 + 每日备份
- WebCrypto — PBKDF2-SHA256 密码哈希 + HS256 JWT
- Cache API — 图标缓存 30 天

## 免费档注意事项

1. **不要**用 bcrypt 做密码哈希 — 10 ms CPU 不够，会触发 Error 1102。本项目已用 PBKDF2-SHA256。
2. **不要**每张图标都直连 R2 — 免费档每次请求最多 50 个子请求。本项目用 Cache API 缓存图标 30 天。
3. **不要**把 SECRET 写在 wrangler.toml — 放 Cloudflare 控制台的 Variables & Secrets 里。
