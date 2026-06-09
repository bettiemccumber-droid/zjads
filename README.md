# ZJADS

联盟数据采集与广告投放分析中台（公司内部版）。

## 文档

- [产品需求文档（PRD）](./docs/PRD.md)
- [技术设计文档](./docs/TECHNICAL.md)
- [Railway 部署指南](./docs/RAILWAY.md)

## 快速开始

### 1. 启动基础设施

```bash
docker compose up -d
```

### 2. 后端

```bash
cd apps/api
cp .env.example .env
npm install
npx prisma migrate dev
npm run prisma:seed
npm run start:dev
```

默认管理员：`admin@company.local` / `Admin123!`（仅开发环境，首次 seed 后请修改）

### 3. 前端

```bash
cd apps/web
npm install
npm run dev
```

访问 http://localhost:5173

## 目录

```
apps/api   - NestJS API + Prisma + Worker
apps/web   - React 管理/运营工作台
docs/      - PRD、技术文档
```

## 开发阶段

| 阶段 | 状态 |
|------|------|
| 0 文档 + 脚手架 | 进行中 |
| 1 认证、渠道账号、PM 采集、报表、预警 | 待开发 |
| 2 Google Sheet、完整前端 | 待开发 |
