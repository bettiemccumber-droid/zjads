# ZJADS 分步实施计划

与 [PRD.md](./PRD.md)、[TECHNICAL.md](./TECHNICAL.md) 配套使用。

## 阶段 0：文档与脚手架 ✅

- [x] PRD.md
- [x] TECHNICAL.md
- [x] Monorepo + Docker Compose
- [x] Prisma Schema
- [x] NestJS API 骨架
- [x] React 前端骨架

## 阶段 1：核心后端（进行中）

- [x] 认证 JWT + 角色
- [x] 平台列表、渠道账号 CRUD（加密 Token）
- [x] PartnerMatic 采集 + SyncJob
- [x] 订单明细、结算商家汇总
- [x] 商家汇总 / ROI 报表
- [x] 佣金失效预警
- [x] 管理员：用户管理、公司经营看板
- [ ] 单元测试（采集、ROI、预警）
- [ ] 完善 PM Channel API 参数（若平台要求）

## 阶段 2：前端完整流程

- [ ] 登录页
- [ ] 我的平台账号（按平台 Tab）
- [ ] 数据采集页 + 商家汇总表
- [ ] 结算查询 + 失效佣金面板
- [ ] 管理员：经营看板、员工管理
- [ ] 路由与权限守卫

## 阶段 3：广告数据（徐版 Sheet）

- [ ] AdDataSource CRUD
- [ ] CSV 拉取 `raw_daily_report` 解析
- [ ] `ad_campaign_daily` 聚合 + campaign 名解析
- [ ] 商家汇总合并广告费

## 阶段 4：扩展

- [ ] LinkHaitao / LinkBux Collector
- [ ] BullMQ Worker 独立进程
- [ ] 榜单 Top10、Excel 导出
- [ ] 审计日志

## 当前迭代命令

```bash
docker compose up -d
cd apps/api && cp .env.example .env && npm install
npx prisma migrate dev --name init
npm run prisma:seed
npm run start:dev
cd ../web && npm install && npm run dev
```
