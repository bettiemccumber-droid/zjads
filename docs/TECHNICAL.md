# ZJADS 技术设计文档

| 项目 | 内容 |
|------|------|
| 版本 | v1.0 |
| 关联 | [PRD.md](./PRD.md) |

---

## 1. 技术栈

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端 | React 18 + Vite + TypeScript + Ant Design 5 | 运营工作台 UI |
| 后端 | NestJS 10 + TypeScript | REST API |
| ORM | Prisma 5 | MySQL 迁移与类型安全 |
| 数据库 | MySQL 8 | 主库 |
| 队列 | BullMQ + Redis 7 | 采集任务 |
| 认证 | JWT（access token） | 无 refresh 首期可简化 |
| 脚本 | Google Ads 徐版脚本 → Google Sheet | 广告原始数据 |
| 容器 | Docker Compose | 本地与部署 |

**Monorepo 结构：**

```
zjads/
├── apps/
│   ├── api/          # NestJS API + Worker 入口
│   └── web/          # React 前端
├── packages/         # （可选）共享类型
├── docs/
│   ├── PRD.md
│   └── TECHNICAL.md
├── docker-compose.yml
└── README.md
```

---

## 2. 系统架构

```
┌─────────────┐     HTTPS      ┌─────────────┐
│  apps/web   │ ◄────────────► │  apps/api   │
└─────────────┘                └──────┬──────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌──────────┐    ┌──────────┐    ┌──────────────┐
              │  MySQL   │    │  Redis   │    │  Collectors  │
              └──────────┘    │ (BullMQ) │    │  (PM, LH…)   │
                              └──────────┘    └──────┬───────┘
                                                     │
                              ┌──────────────────────┴──────────┐
                              ▼                                 ▼
                       联盟平台 API                    Google Sheet CSV
```

### 2.1 模块划分（NestJS）

| 模块 | 职责 |
|------|------|
| `AuthModule` | 登录、JWT、守卫 |
| `UsersModule` | 用户 CRUD（管理员） |
| `PlatformsModule` | 平台字典、状态映射查询 |
| `ChannelAccountsModule` | 渠道账号 CRUD、凭证加解密 |
| `SyncModule` | 采集任务创建、状态查询 |
| `OrdersModule` | 订单明细、结算汇总 |
| `ReportsModule` | 商家汇总、ROI、公司/员工看板 |
| `AlertsModule` | 佣金失效规则与告警 |
| `AdSourcesModule` | Google Sheet 配置与导入（P1） |
| `CollectorsModule` | 平台 Adapter 注册与执行 |
| `PrismaModule` | 全局 Prisma 服务 |

### 2.2 权限实现

```typescript
// 伪代码
@UseGuards(JwtAuthGuard, RolesGuard)
class ReportsController {
  @Get('merchant-summary')
  merchantSummary(@CurrentUser() user, @Query() q) {
    const ownerId = user.role === 'admin' && q.userId ? q.userId : user.id;
    return this.reports.merchantSummary(ownerId, q);
  }

  @Get('company-dashboard')
  @Roles('admin')
  companyDashboard(@Query() q) {
    return this.reports.companyAggregate(q);
  }
}
```

- **Prisma 中间件或 Service 层**统一注入 `where: { channelAccount: { ownerUserId } } }`（非 admin）。

---

## 3. 数据库设计（MySQL）

### 3.1 ER 关系（简述）

```
organizations 1──n users
users 1──n channel_accounts
platforms 1──n channel_accounts
platforms 1──n platform_status_mappings
channel_accounts 1──n affiliate_orders
channel_accounts 1──n sync_job_items
users 1──n ad_data_sources
users 1──n commission_alert_rules
users 1──n commission_alerts
```

### 3.2 核心表（Prisma 模型名）

| 模型 | 说明 |
|------|------|
| `Organization` | 公司（首期可单条种子数据） |
| `User` | 用户，`role`: ADMIN \| OPERATOR \| VIEWER |
| `Platform` | 平台注册表，`code` 唯一 |
| `PlatformStatusMapping` | 原始状态 → normalized |
| `ChannelAccount` | 渠道账号 + 加密凭证 |
| `AffiliateOrder` | 标准化订单 |
| `SyncJob` / `SyncJobItem` | 采集父/子任务 |
| `AdDataSource` | Sheet URL（P1） |
| `AdCampaignDaily` | 广告 Campaign 日聚合（P1） |
| `CommissionAlertRule` | 用户告警规则 |
| `CommissionAlert` | 告警实例 |
| `AuditLog` | 审计（P1） |

### 3.3 关键约束

```sql
-- 同一员工同一平台同一 Channel 不重复
UNIQUE (owner_user_id, platform_id, external_channel_id)

-- 订单去重
UNIQUE (channel_account_id, external_order_id)
```

`external_channel_id` 空字符串与 NULL 统一处理：PM 无 Channel 的平台用 `''` 占位。

### 3.4 凭证加密

- 环境变量 `CREDENTIALS_ENCRYPTION_KEY`（32 字节 hex）。
- `ChannelAccount.credentialsEnc` 存 AES-256-GCM 密文 JSON：`{ apiToken, ... }`。

---

## 4. 平台采集框架

### 4.1 接口

```typescript
interface PlatformCollector {
  readonly platformCode: string;
  validateCredentials(ctx: CollectorContext): Promise<void>;
  fetchOrders(ctx: CollectorContext, range: DateRange): AsyncIterable<RawOrder>;
  normalizeOrder(raw: RawOrder, mappings: StatusMapping[]): NormalizedOrder;
}
```

### 4.2 PartnerMatic（首期）

- **API**：`POST https://api.partnermatic.com/api/transaction`
- **Body**：`token`, `beginDate`, `endDate`, `curPage`, `perPage`, `dataScope: 'user'`
- **Channel**：若 API 支持 channel 参数则传入 `external_channel_id`；否则 **一 Channel 一 Token** 账号记录。
- **合并**：同一 `oid` 多 `items` 累加 `sale_amount`、`sale_comm`。
- **状态**：`Approved` → approved；`Rejected`/`Canceled` → rejected；其余 → pending。
- **日期**：`order_time` 时间戳按 UTC+8 自然日（与现网一致）。

### 4.3 注册 Collector

```typescript
// collectors.registry.ts
const collectors = new Map<string, PlatformCollector>();
collectors.set('partnermatic', new PartnerMaticCollector());
```

新增平台：实现接口 + DB `platforms` 插入 + 状态映射 seed。

---

## 5. 报表 SQL 策略

### 5.1 商家汇总（员工 scope）

1. **订单侧**：`affiliate_orders` JOIN `channel_accounts`  
   `WHERE owner_user_id = ? AND order_date BETWEEN ? AND ?`  
   `GROUP BY merchant_id, affiliate_alias, product_id(optional)`

2. **广告侧（P1）**：`ad_campaign_daily` 同 owner、`date` 范围  
   `GROUP BY merchant_id, affiliate_alias`  
   `SUM(impressions, clicks, cost)`

3. **合并键**：`merchant_id` + `LOWER(affiliate_alias)`（+ `product_id` for PB）

4. **ROI 行级**：`(total_commission - total_cost) / total_cost`

### 5.2 公司看板（admin）

```sql
-- 按员工
SELECT u.id, u.username,
  SUM(commission), SUM(ad_cost), ...
FROM users u
LEFT JOIN ... GROUP BY u.id

-- 公司合计
SELECT SUM(commission), SUM(ad_cost) FROM ... -- 同上 without group by user
```

### 5.3 佣金失效检查

```sql
SELECT merchant_id, merchant_name,
  SUM(commission) AS total_commission,
  SUM(CASE WHEN normalized_status = 'rejected' THEN commission ELSE 0 END) AS rejected_commission
FROM affiliate_orders
WHERE owner_user_id = ? AND order_date BETWEEN ? AND ?
GROUP BY merchant_id
```

触发：`rejected >= threshold_amount OR rate >= threshold_rate`。

---

## 6. Google 广告数据（P1）

### 6.1 脚本

- 使用 **徐版统计脚本**（`raw_daily_report` 等 Sheet）。
- 员工各自配置 `AdDataSource.sheetUrl`（或公司按人分配 Sheet）。

### 6.2 导入流程

1. `GET export?format=csv&gid=0` 或 Sheets API。
2. 解析表头 `REPORT_HEADERS`（`DATA_SCHEMA_VER=11`）。
3. 写入 `ad_raw_rows`（可选）或直聚合。
4. `INSERT ... ON DUPLICATE KEY UPDATE` → `ad_campaign_daily`  
   键：`(owner_user_id, date, customer_id, campaign_id)`。

### 6.3 Campaign 解析

```typescript
function parseCampaignName(name: string): {
  affiliateAlias: string;
  merchantId: string;
  merchantSlug: string;
}
// 规则见 PRD 附录；PB 识别 ASIN
```

---

## 7. API 约定（REST）

**Base**：`/api/v1`

| 方法 | 路径 | 角色 | 说明 |
|------|------|------|------|
| POST | `/auth/login` | 公开 | 登录 |
| GET | `/auth/me` | 登录 | 当前用户 |
| GET/POST | `/channel-accounts` | 登录 | 我的渠道账号 |
| GET | `/platforms` | 登录 | 平台列表 |
| POST | `/sync/jobs` | operator+ | 创建采集 |
| GET | `/sync/jobs/:id` | 登录 | 任务状态 |
| GET | `/orders` | 登录 | 订单明细分页 |
| GET | `/reports/merchant-summary` | 登录 | 商家汇总 |
| GET | `/reports/company-dashboard` | admin | 公司经营看板 |
| GET/POST | `/commission-alert-rule` | 登录 | 规则 |
| GET | `/commission-alerts` | 登录 | 告警列表 |
| POST | `/commission-alerts/check` | 登录 | 立即检查 |
| POST | `/commission-alerts/:id/ack` | 登录 | 确认告警 |
| CRUD | `/admin/users` | admin | 员工管理 |

查询参数统一：`startDate`, `endDate`, `userId`（仅 admin）、`platformAccountId`, `status`, `page`, `pageSize`。

响应：

```json
{ "success": true, "data": {}, "message": "" }
```

---

## 8. 前端结构

```
apps/web/src/
├── api/           # axios 封装
├── pages/
│   ├── Login.tsx
│   ├── Dashboard.tsx      # 数据采集/商家汇总
│   ├── Settlement.tsx     # 结算查询
│   ├── ChannelAccounts.tsx
│   ├── Admin/
│   │   ├── CompanyDashboard.tsx
│   │   ├── Users.tsx
│   │   └── Alerts.tsx
│   └── Settings.tsx
├── components/
├── hooks/
└── stores/        # 可选 zustand
```

路由守卫：`role === admin` 显示管理菜单。

---

## 9. 环境变量

```env
# apps/api/.env
DATABASE_URL=mysql://zjads:zjads@localhost:3306/zjads
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d
CREDENTIALS_ENCRYPTION_KEY=64hexchars...
PORT=3000
```

---

## 10. 部署

```bash
docker compose up -d    # mysql, redis
cd apps/api && npx prisma migrate dev
npm run start:dev       # API
npm run worker:dev      # BullMQ worker（可与 API 同进程或独立）
cd apps/web && npm run dev
```

生产：API + Worker 分进程；Nginx 反代；MySQL 备份。

---

## 11. 测试策略

| 类型 | 内容 |
|------|------|
| 单元 | `parseCampaignName`、`normalizeStatus`、ROI 计算 |
| 集成 | PM Collector mock API |
| E2E | 登录 → 添加账号 → 采集 → 商家汇总（后期 Playwright） |

---

## 12. 安全清单

- [ ] 生产 JWT_SECRET 随机强密钥
- [ ] 凭证加密密钥不入库
- [ ] SQL 全参数化（Prisma）
- [ ] 管理员接口 RolesGuard
- [ ] CORS 限制前端域名
- [ ] Rate limit 登录接口（后期）

---

## 13. 变更记录

| 日期 | 版本 | 说明 |
|------|------|------|
| 2026-06-02 | 1.0 | 初稿：PRD 对齐、架构、表设计、PM 采集、ROI/预警口径 |

---

*实现时以 `apps/api/prisma/schema.prisma` 为数据库单一事实来源。*
