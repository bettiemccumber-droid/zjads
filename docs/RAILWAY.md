# Railway 部署指南

ZJADS 在 Railway 上采用 **1 个 MySQL + 2 个 Service（API / Web）** 架构。

## 架构

```
Railway Project
├── MySQL
├── zjads-api    ← apps/api (NestJS)
└── zjads-web    ← apps/web (React 静态站)
```

Redis 当前代码未使用，可暂不创建。

---

## 1. 推送代码到 GitHub

```bash
git push origin main
```

---

## 2. 创建 Railway 项目

1. 打开 https://railway.com ，订阅 **Hobby Plan**（$5/月）
2. **New Project** → **Deploy from GitHub repo** → 选择本仓库

---

## 3. 添加 MySQL

1. 项目内 **+ New** → **Database** → **MySQL**
2. 等待启动完成，记住服务名（默认可能是 `MySQL`）

---

## 4. 部署 API 服务

### 新建 Service

**+ New** → **GitHub Repo** → 再次选择同一仓库。

### Settings → Source

| 项 | 值 |
|----|-----|
| Service Name | `zjads-api` |
| **Root Directory** | 留空（仓库根目录，workspaces 必须从根 `npm ci`） |
| **Watch Paths** | `apps/api/**` , `package.json` , `package-lock.json` |

### Settings → Build

| 项 | 值 |
|----|-----|
| **Build Command** | `npm run build:api` |
| **Start Command** | `npm run start:api` |

### Variables

| 变量 | 值 |
|------|-----|
| `DATABASE_URL` | `${{MySQL.MYSQL_URL}}`（按实际 MySQL 服务名调整，如 `${{mysql.MYSQL_URL}}`） |
| `JWT_SECRET` | 随机长字符串（生产必改） |
| `JWT_EXPIRES_IN` | `7d` |
| `CREDENTIALS_ENCRYPTION_KEY` | 64 位 hex（见 `apps/api/.env.example`） |
| `CORS_ORIGIN` | 先填 `https://placeholder`，Web 域名生成后再改 |
| `NODE_ENV` | `production` |

### Networking

**Generate Domain**，得到 API 公网地址，例如：

```text
https://zjads-api-production-xxxx.up.railway.app
```

### 初始化数据库（首次一次）

安装 CLI 后在本地执行：

```bash
npm i -g @railway/cli
railway login
railway link    # 选择项目，并选中 zjads-api 服务

railway run -- npm run prisma:deploy --workspace=@zjads/api
railway run -- npm run prisma:seed --workspace=@zjads/api
```

> 生产环境 seed 后请立即修改默认管理员密码。

验证 API：

```text
https://你的-api-域名.up.railway.app/api/v1
```

---

## 5. 部署 Web 服务

### 新建 Service

同样连接 GitHub 仓库。

### Settings → Source

| 项 | 值 |
|----|-----|
| Service Name | `zjads-web` |
| **Root Directory** | 留空 |
| **Watch Paths** | `apps/web/**` , `package.json` , `package-lock.json` |

### Settings → Build

| 项 | 值 |
|----|-----|
| **Build Command** | `npm run build:web` |
| **Start Command** | `npm run start:web` |

### Variables（构建时注入）

| 变量 | 值 |
|------|-----|
| `VITE_API_URL` | `https://你的-api-域名.up.railway.app/api/v1` |

⚠️ 修改 `VITE_API_URL` 后必须 **Redeploy**，Vite 在 build 阶段写入该值。

### Networking

**Generate Domain**，例如：

```text
https://zjads-web-production-xxxx.up.railway.app
```

### 回改 API CORS

到 **zjads-api** → **Variables**，更新：

```text
CORS_ORIGIN=https://你的-web-域名.up.railway.app
```

---

## 6. 登录验证

1. 打开 Web 域名
2. 使用 seed 账号登录（见 `apps/api/prisma/seed.ts`）
3. 修改默认密码，测试报表与 Sheet 导入

---

## 7. 常用命令

| 操作 | 命令 |
|------|------|
| 本地构建 API | `npm run build:api` |
| 本地构建 Web | `npm run build:web` |
| 推送 schema 到生产库 | `railway run -- npm run prisma:deploy --workspace=@zjads/api` |
| 查看日志 | Railway Dashboard → 对应 Service → Deployments → View Logs |

---

## 8. 资源与费用建议

| Service | 建议内存 |
|---------|----------|
| zjads-api | 512MB～1GB |
| MySQL | 512MB～1GB |
| zjads-web | 256MB |

Hobby 含 $5 资源额度，全套常驻约 **$20～35/月**，以 Dashboard → Usage 为准。

---

## 9. 故障排查

| 现象 | 处理 |
|------|------|
| `Cannot find module .../dist/main` | 确认 Build 成功；根目录已有 `nixpacks.toml`（`npm ci --include=dev`）；Build 命令为 `npm run build:api` |
| `Application failed to respond` / 表不存在 P2021 | 首次部署需 seed；启动时会自动 `prisma db push` 建表，Redeploy 后应 Online；仍失败则查 `DATABASE_URL` |
| API 启动报 Prisma Client 未生成 | 确认 Build 命令含 `npm run build:api`（内含 `prisma generate`） |
| 前端请求失败 / CORS | 检查 `VITE_API_URL` 与 `CORS_ORIGIN` 域名是否完全一致 |
| 前端仍请求 localhost | 改 `VITE_API_URL` 后重新 Deploy Web |
| `npm ci` 失败 | Root Directory 必须为仓库根，不能填 `apps/api` |
| 国内访问慢 | Railway 节点在海外，长期可迁国内 VPS |

---

## 10. 环境变量速查

### API（`apps/api/.env.example`）

```env
DATABASE_URL=...
JWT_SECRET=...
JWT_EXPIRES_IN=7d
CREDENTIALS_ENCRYPTION_KEY=...
CORS_ORIGIN=https://你的-web-域名.up.railway.app
PORT=3000
```

### Web（`apps/web/.env.example`）

```env
VITE_API_URL=https://你的-api-域名.up.railway.app/api/v1
```
