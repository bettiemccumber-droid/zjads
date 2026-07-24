# UltraInfluence 联盟平台接入规划

> **状态**：📝 **9/9 侧边栏 API 已全部记录** · **尚未开始编码**（待负责人确认后开发）

- 联盟后台：[UltraInfluence](https://app.ultrainfluence.com/)
- Transaction API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/transaction_api/52)
- Transaction API V3：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/transaction_api_v3/59) — **F3 建议采用**
- Click Report API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/click_report/57)
- Monetization API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/monetization_api/56)
- Commission Validation API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/Commission%20Validation%20API/58)
- Commission Details API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/Details%20API/53)
- Payment Summary API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/payment_summary_api/55)
- Payment Detail API：[文档 v1.0](https://app.ultrainfluence.com/tools/apis/payment_detail_api/54)
- 内部 platform code（建议，待确认）：`ultrainfluence`
- 广告系列联盟序号前缀（建议，待确认）：`ui1` / `ui2` …

---

## 工作流程约定

1. 负责人提供 UltraInfluence API 文档与凭证说明 → 填入本文「API 文档记录」
2. 梳理功能清单与 API 映射 → 更新本文「功能 ↔ API 对照」
3. **负责人书面同意开始开发** → 再按本文实施清单写代码
4. 开发完成后按「验收清单」逐项验证

---

## 数据对齐需求（负责人明确要求 · 2026-07-24）

ZJADS 工作台 / 商家分析需与**外部数据源逐日、逐商家对齐**，与现有 PM/LB 平台体验一致（见截图：主表区间汇总 + 展开「按天详细数据」）。

### UI 后台 Performance 报表（对齐基准 · 2026-07-24 截图）

UltraInfluence 后台路径：**Reports → Performance**。

| UI 元素 | 内容 | ZJADS 对齐说明 |
|---------|------|----------------|
| **Group** | `By Day` | 对应 ZJADS 展开「按天详细数据」；非 By Day 时仅作 UI 参考 |
| **日期** | `2026-07-24` ~ `2026-07-24`（`YYYY-MM-DD`） | 与 API `beginDate/endDate`、ZJADS 顶部采集区间 **同一 UTC+8 日历日** |
| **状态 Tab** | **All** / Approved / Pending / Rejected | **ZJADS 主表默认对齐 `All` Tab**（见下表）；Approved 列单独对账用 |
| **汇总卡** | Total Clicks / Orders / Sales / **Est. Commission** | 区间加总 = ZJADS 主表对应列 |
| **明细表列** | Date, Clicks, Orders, …, **Est. Commission**, Approved Commission | 按天行 = ZJADS 展开子表；合计 = 主表联盟侧 |

**截图样例（2026-07-24，All Tab，By Day）**

| UI 字段 | 值 | ZJADS 列 |
|---------|-----|----------|
| Clicks | **2** | 联盟点击 |
| Orders | **0** | 订单数 |
| Est. Commission | **$0** | 总佣金（`commission`） |
| Approved Commission | $0 | ZJADS **暂无单独列**；F14/F9 对账用 |

> UI **没有单独 Performance API**（侧边栏 9 个 API 已齐）。该页由 **Click Report（点击）+ Transaction（订单/Est. Commission）** 聚合而成；ZJADS 用 **F8 + F3** 复现同一视图，不另接 API。

**UI 列 ↔ ZJADS ↔ 数据来源**

| UI Performance 列 | ZJADS | 采集来源 | 默认 Tab |
|-------------------|-------|----------|----------|
| **Clicks** | 联盟点击 | Click Report → `affiliate_merchant_click_daily` | All |
| **Orders** | 订单数 | Transaction V3 → `affiliate_orders`（dedupe `oid`） | **All** |
| **Est. Commission($)** | 总佣金 | Transaction V3 `sale_comm` 求和 | **All** |
| **Approved Commission($)** | _(无)_ | 仅 `Approved` 状态 item 的 `sale_comm` | Approved Tab |
| Sales Amount | _(无)_ | `sale_amount` 可选扩展 | All |
| EPC / CR | 计算列 | `commission/clicks`、`orders/clicks` | All |

**状态 Tab 口径（负责人已确认）**

> **`All` = 全部状态**（Pending + Approved + Rejected + …），订单数与 **Est. Commission 均为全量汇总。  
> **Approved / Pending / Rejected** 三个 Tab 才是按状态**拆分**后的子集；ZJADS 主表不对齐分 Tab，只对齐 **All**。

| UI Tab | 订单 / Est. Commission 规则 | ZJADS 用途 |
|--------|----------------------------|------------|
| **All** | **所有状态**均计入（含 Rejected；comm=0 的单仍算 1 单、佣金加 0） | **工作台 / 商家分析默认对齐** |
| Pending | 仅 Pending | 结算 pending 视图可参考 |
| Approved | 仅 Approved | 对应 UI「Approved Commission」列 / F14 对账 |
| Rejected | 仅 Rejected | diag；不进 ZJADS 主表单独展示 |

**UI 筛选项（API 侧）**

| UI 筛选 | API 参数 |
|---------|----------|
| Brand Name / ID | Transaction / Click：`dataScope` + 入库后按 `mid` 过滤 |
| Channel | 默认 `dataScope: channel`（单 Token 单 Channel） |
| UID | Transaction `uid` 字段；ZJADS 全量采集不按 UID 拆（系列归因靠 Google 侧） |

### 对齐目标（两类数据源）

| 指标 | 对齐对象 | ZJADS 展示位置 | 数据来源 |
|------|----------|----------------|----------|
| **订单数** | UltraInfluence 后台同商家、同日期 | 主表 + 按天展开「订单」列 | Transaction V3 → `affiliate_orders` |
| **总佣金** | UI Performance **`Est. Commission`（All Tab）** | 主表 + 按天展开「佣金」列 | Transaction V3 → `affiliate_orders` |
| **联盟点击** | UI Performance **Clicks（All Tab）** | 主表 + 按天展开「联盟点击」列 | Click Report → `affiliate_merchant_click_daily` |
| **广告费 / MCC 点击 / 展示** | Google Ads 后台同账户、同日期 | 主表 + 按天展开对应列 | MCC Sheet → `ad_campaign_daily` |

> **「今天」硬要求**：选定商家后，ZJADS 上**今天**的订单数、佣金、联盟点击必须与 UltraInfluence 后台一致；广告费、MCC 点击必须与 Google Ads 一致（各自按下方时区规则）。

### ZJADS 现有报表架构（UI 接入后沿用）

```
┌─────────────────────────────────────────────────────────────┐
│  主表（区间汇总） campaignSummary / merchantSummary          │
│  订单/佣金/联盟点击 ← affiliate_orders + click_daily 聚合    │
│  广告费/MCC点击/展示 ← ad_campaign_daily 聚合                │
└─────────────────────────────────────────────────────────────┘
                          │ 展开
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  按天详细数据 campaignDaily                                  │
│  每一行 = Google 有数据的 (campaign × date)                  │
│  当日联盟指标 ← buildAffiliateMetricsByMerchantDay 按日 JOIN │
│  合计行 = 各天相加（与主表联盟侧应一致）                      │
└─────────────────────────────────────────────────────────────┘
```

实现参考：`reports.service.ts` 的 `buildAffiliateMetricsByMerchantDay`、`lookupAffiliateMetricsForDay`、`campaignDaily`；归因去重参考 `campaign-affiliate-attribution.util.ts`（UI 需新增 `ui*` 平台族）。

### 时区与「自然日」约定

| 系统 | 自然日基准 | ZJADS 处理方式 |
|------|------------|----------------|
| **UltraInfluence 订单** | 文档 + 样例 `order_time: "2024-02-08 22:13:59"` | **`UTC+8` 自然日**；复用 `parseAffiliateOrderDateUtc8()`：字符串取日期部分；Unix 秒（`ori_order_time`）加 +8h 再取日 |
| **UltraInfluence 点击** | Click Report 文档明确 **UTC+8** | `click_time` 取 `YYYY-MM-DD` 部分 → `affiliate_merchant_click_daily.clickDate` |
| **UltraInfluence API 查询参数** | `beginDate` / `endDate` 为 `YYYY-MM-DD` | **按 UTC+8 日历日**传参（与 PM 一致）；用户选 7/17–7/23 即传这 7 个 UTC+8 日 |
| **Google Ads** | 各子账户 **账户时区**（MCC 脚本 `cfg.timezone`） | Sheet `date` 列原样入库；与 Google Ads UI 按账户时区对齐 |
| **ZJADS 库内 date 字段** | `@db.Date` 存 UTC 零点 | 读写用 `formatCalendarDateUtc()`，**禁止** `toISOString()` 直接切片（避免 UTC 偏移） |

#### 跨系统日期临界（必须知晓）

联盟（UTC+8）与 Google Ads（常见 `America/Los_Angeles` 等）**不是同一套「今天」**：

- 北京时间 **7/24 上午**，美西账户 Google 侧可能仍是 **7/23** — 这是预期行为，不是 bug。
- **联盟三指标**（订单/佣金/联盟点击）只与 UltraInfluence 对齐，按 **UTC+8** 归因。
- **广告三指标**（广告费/MCC 点击/展示）只与 Google Ads 对齐，按 **账户时区** 归因。
- 按天展开行以 **Google 有 spend/click 的 date** 为主键；联盟侧通过 `merchantId + dateStr` 挂载同日数据（现有 PM 逻辑）。

### 日期临界与采集策略

| 场景 | 策略 |
|------|------|
| 用户选区间 `[startDate, endDate]` | 订单 API 按 UTC+8 日传 `beginDate/endDate`；点击 API 将区间拆为 **UTC+8 每小时片**（≤1h，1011） |
| **「今天」要对齐** | 定时/手动采集必须 **包含 today**；建议每次再重采 **today + yesterday**（防 API 延迟、状态变更） |
| 跨日边界（如 23:59 UTC+8 下单） | `order_time` 字符串日期即归属日；Unix 路径用 +8h 取日，与 UI 后台一致 |
| 采集后修正 orderDate | 现有 `collectors.service` 会在重采前 **删除区间内旧订单** 再写入（防 skipDuplicates 漏更新） |
| Transaction 62 天限制 | 长区间按 62 天 chunk（v1 有 1006；V3 待实测，仍建议 chunk） |
| Click 10 req/min | 1012 限速；小时片多时需 sleep，避免漏采导致点击偏低 |

### 计数口径（与 UI 对齐 — 开发前需抽样验证）

| 指标 | 规划默认（待 UI 后台对照确认） |
|------|--------------------------------|
| **订单数** | 按 **去重订单** 计数，非商品行数；V3 建议 dedupe 键 = **`oid`**（同 PM 的 oid），`externalOrderId` 存 `ultrainfluence_id` 或 `ui:{oid}` |
| **佣金** | **`sale_comm` 全量求和（不过滤 status）** | = UI **All Tab → Est. Commission** |
| **联盟点击** | Click Report 行数 | = UI **All Tab → Clicks** |
| **状态过滤** | **报表层不过滤**；与 UI **All Tab** 一致 | 分 Tab 仅 UI 后台展示用，ZJADS 入库保留 `rawStatus` 供结算页区分 |

### API ↔ 功能优先级调整（对齐驱动）

| 功能 | 原优先级 | **调整后** | 原因 |
|------|----------|------------|------|
| F3 订单采集 | P0 | **P0** | 订单数 + 佣金 |
| F8 点击采集 | P1 | **P0** | 联盟点击列无法对齐则验收不通过 |
| F6 报表归因 `ui*` | P0 | **P0** | 同商家 ui1/ui2 去重 |
| F11 MCC Sheet | P2 | **P0（并行）** | 广告费/MCC 点击对齐依赖 Sheet 导入 |

### 验收清单（开发完成后）

以**单一商家 + 单一日期**（建议先测 **昨天** 与 **今天**）逐项对照：

- [ ] UI Performance **All Tab**：该日 **Clicks / Orders / Est. Commission** = ZJADS 三列（**全状态**，样例 2026-07-24：2 / 0 / $0）
- [ ] Google Ads 后台（账户时区）：该系列该日 **Cost / Clicks / Impressions** = ZJADS 对应列
- [ ] 区间 7 天：主表联盟指标 = 按天展开合计行加总
- [ ] 跨日边界：UTC+8 23:55 订单归属正确日期（非次日）
- [ ] `ui1` / `ui2` 同 merchantId 不重复计佣金（平台族去重）
- [ ] 重采 today 后数值与 UI 刷新一致（无 stale 旧单）

---

## 已收录 API 列表（侧边栏）

| API 名称 | 文档状态 | 备注 |
|----------|----------|------|
| **Transaction API** | ✅ 已记录（v1.0，2024/03/03） | 与 PartnerMatic Transaction API **结构高度相似** |
| **Click Report API** | ✅ 已记录（v1.0，2026/03/03） | 与 PartnerMatic Click Report **几乎相同**（1 小时片 + 10 req/min） |
| **Monetization API** | ✅ 已记录（v1.0，2026/03/03） | 商家目录 / 推广链接；**brand_id 为数字 ID** |
| **Commission Validation API** | ✅ 已记录（v1.0，2026/03/03） | 按品牌 **已批准佣金** 汇总；62 天区间 |
| **Commission Details API** | ✅ 已记录（v1.0，2024/03/03） | 按 `settlementId` 展开订单明细；**F9/F14 下钻** |
| **Payment Summary API** | ✅ 已记录（v1.0，2026/03/03） | 付款历史汇总；**F10** |
| **Payment Detail API** | ✅ 已记录（v1.0，2026/03/03） | 付款明细下钻；与 Summary / settlement 衔接 |
| **Transaction API V3** | ✅ 已记录（v1.0，2024/03/03） | **建议 F3 优先用 V3**；订单+items 嵌套，更接近 PM |

---

## API 文档记录

### 1. 鉴权

| 项目 | 内容 |
|------|------|
| 鉴权方式 | 请求 Body 内 `token` 字段（非 Header Bearer） |
| `source` | 固定 `"ultrainfluence"` |
| Token 示例 | 文档页展示 Channel 下拉 + Token 字符串（如 `0938bc308f94e579fd0466f0fa7d0420`） |
| Token 获取 | UltraInfluence 后台 Tools / API Detail 页面（按 Channel 分配） |
| Base URL | `https://api.ultrainfluence.com` |
| Content-Type | `application/json` |
| 测试/生产 | 文档未区分，暂视为同一域名 |

### 2. Transaction API（订单 / 佣金）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Transaction API v1.0](https://app.ultrainfluence.com/tools/apis/transaction_api/52) |
| 接口 URL | `POST https://api.ultrainfluence.com/api/transaction` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"`（**字符串**，非数字） |
| 分页 | `curPage`（从 1 起）、`perPage`（最大 **2000**）；响应 `total` / `totalPage` / `hasNext` |
| 日期区间限制 | **单次查询不超过 62 天**（错误码 1006）；数据最早 **2023-01-01** |
| 速率限制 | 错误码 1002「Call frequency too high」 |

#### 2.1 必填参数

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| **二选一（日期组）** | |
| `beginDate` + `endDate` | 交易发生区间，`YYYY-MM-DD` |
| `beginApproveDate` + `endApproveDate` | 验证/批准区间，`YYYY-MM-DD` |

> ZJADS 结算按 **订单发生日** 采集，首选 `beginDate` / `endDate`（与 PM 一致）。

#### 2.2 可选参数（Filter）

| 参数 | 说明 | ZJADS 用途建议 |
|------|------|----------------|
| `dataScope` | `"channel"`（默认，仅当前 Token 对应 Channel）或 `"user"`（该用户下全部 Channel） | 建议 **`"user"`**，与 PM 采集一致 |
| `orderId` | 订单 ID | 单笔补采 / 诊断 |
| `status` | 佣金状态，**数组**，如 `["All"]` | 默认不传或 `["All"]` |
| `uid` ~ `uid5` | 自定义追踪变量 | 可存 SubID / 系列追踪码（待业务确认） |
| `brandId` | 数字 Brand ID，如 `66303` | 按商家过滤 |
| `mcid` | 品牌 slug，如 `ulike0` | 按商家过滤 |
| `curPage` | 当前页 | 分页循环 |
| `perPage` | 每页条数，max 2000 | 建议 2000 |

#### 2.3 请求示例（文档 curl）

```json
POST https://api.ultrainfluence.com/api/transaction
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "dataScope": "user",
  "beginDate": "2025-06-01",
  "endDate": "2025-06-05",
  "curPage": 1,
  "perPage": 20
}
```

#### 2.4 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total": 2,
    "curPage": 1,
    "totalPage": 1,
    "hasNext": true,
    "list": [ { /* 见下表 */ } ]
  }
}
```

#### 2.5 `list[]` 字段（Return parameters）

| 字段 | 类型/示例 | 说明 |
|------|-----------|------|
| `ultrainfluence_id` | string | UltraInfluence 系统唯一 ID |
| `brand_id` | number | Brand ID（示例中为 `0`，文档称如 `66303`） |
| `mcid` | string | 品牌唯一 slug（如 `audioengine`） |
| `merchant_name` | string \| null | 品牌名 |
| `order_id` | string | 订单 ID（如 `19191.5860.49139`） |
| `order_time` | number | 交易时间 **Unix 时间戳**（如 `1705520048`） |
| `sale_amount` | number | 销售额 |
| `sale_comm` | number | 佣金 |
| `status` | string | 佣金状态（示例：`Pending`） |
| `norm_id` | number | 示例 `395`，含义待确认 |
| `ori_amount` | number | 原始金额 |
| `ori_aff_brokerage` | number | 原始联盟佣金 |
| `prod_id` | string | 商品 ID |
| `order_unit` | number | 订单件数 |
| `uid` ~ `uid5` | string \| null | 自定义追踪变量 |
| `click_ref` | string | Unique Click Id |
| `comm_rate` | string | 如 `Revshare 70.00%` |
| `validation_date` | string \| null | 验证日期 |
| `note` | string | 状态变更原因（示例 `Paid`） |
| `customer_country` | string \| null | 客户国家 |
| `voucher_code` | string \| null | 优惠码 |
| `is_direct` | number | 示例 `0` |
| `channel_id` | string | 如 `MCZCG08000006` |
| `paid_status` | number | `1`=已付给 Publisher，`0`=未付 |
| `last_update_time` | string | 如 `05-22-2024` |
| `settlement_date` | string \| null | 佣金批准可提现日 |
| `paid_date` | string \| null | 标记已付款日 `YYYY-MM-DD` |

#### 2.6 错误码（Result Code）

| code | 含义 | 采集器处理建议 |
|------|------|----------------|
| `0` | Success | 正常 |
| `1000` | Publisher does not exist | 凭证错误 |
| `1001` | Invalid token | 凭证错误 |
| `1002` | Call frequency too high | 退避重试（参考 PM 1.5s 间隔） |
| `1006` | Query time span cannot exceed 62 days | 按 62 天切分（**与 PM 相同**） |
| `10001` | Missing required parameters or incorrect format | 参数校验 |

#### 2.7 与 PartnerMatic 对比（实现参考）

| 维度 | PartnerMatic | UltraInfluence Transaction API |
|------|--------------|--------------------------------|
| URL | `api.partnermatic.com/api/transaction` | `api.ultrainfluence.com/api/transaction` |
| 方法 | POST JSON | POST JSON |
| 鉴权 | `token` + `source`? | `token` + `source: ultrainfluence` |
| 日期上限 | 62 天 | 62 天 |
| 分页 | curPage / perPage | curPage / perPage（max 2000） |
| dataScope | `user` | `user` / `channel` |
| 列表字段 | oid, mid, sale_comm, status… | order_id, brand_id/mcid, sale_comm, status… |

> **实现时可 largely 参考** `partnermatic.collector.ts` 的分片、分页、normalize 结构；**字段映射需单独定稿**（见下）。

#### 2.8 字段映射草案（**待负责人确认**）

| ZJADS `NormalizedOrder` | UltraInfluence 字段 | 说明 / 待确认 |
|-------------------------|---------------------|---------------|
| `externalOrderId` | `order_id` + `prod_id`？或 `ultrainfluence_id` | 同一 order 多 prod 是否拆行（示例 2 条同 order 前缀不同 prod） |
| `merchantId` | **`brand_id`（首选）** vs `mcid` vs `norm_id` | Monetization 样例 `brand_id=1896` 与 `mid` 一致；Transaction 个别行 `brand_id=0` 时可 fallback `mcid` |
| `merchantName` | `merchant_name` | 可为 null，可 fallback `mcid` |
| `merchantSlug` | `mcid` | |
| `productId` | `prod_id` | |
| `orderAmount` | `sale_amount` | |
| `commission` | `sale_comm` | |
| `currency` | _响应无 currency 字段_ | 默认 USD？待确认 |
| `rawStatus` | `status` | 示例仅见 `Pending` |
| `orderDate` | `order_time`（Unix 秒） | 时区：按 UTC+8 还是 UTC？待确认 |
| `rawPayload` | 整行 JSON | 保留 `channel_id`、`uid`、`paid_status` 等 |

**去重键建议（开发前确认）**：`channelAccountId | order_id | prod_id`（与多商品行示例一致）。**若采用 V3**，可用 `ultrainfluence_id` 或 `oid|skuid`。

---

### 2B. Transaction API V3（订单 / 佣金 — **建议 F3 采用**）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Transaction API V3 v1.0](https://app.ultrainfluence.com/tools/apis/transaction_api_v3/59)（2024/03/03 新增） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/transaction_v3` |
| 用途 | 同 v1：拉详细交易、佣金状态；**结构升级为订单 + items[] 嵌套** |
| 成功标识 | `code === "0"` |

#### 2B.1 与 Transaction API v1 对比（选型依据）

| 维度 | v1 `/api/transaction` | **V3 `/api/transaction_v3`** |
|------|-------------------------|------------------------------|
| 列表结构 | 扁平 `list[]`，一行一 prod | **订单 `list[]` + 嵌套 `items[]`**（≈ PM） |
| 商家 ID 字段 | `brand_id` | **`mid`**（样例 NYDJ `mid: 8000647`） |
| 订单时间 | `order_time` Unix 秒 | **`order_time` 字符串** + `ori_order_time` Unix |
| 订单唯一键 | `order_id` | **`oid`** + `order_id` |
| 商品唯一键 | `prod_id` | **`skuid`** + `ultrainfluence_id` |
| 状态位置 | 行级 `status` | **items[] 内 `status`**（可 Pending/Rejected 分行） |
| 结算字段 | 较少 | items 含 **`settlement_id` / `payment_id` / `paid_date`** |
| 日期查询 | `beginDate/endDate` 或 `beginApproveDate/endApproveDate` | **`beginDate/endDate` 或 `updateBeginDate/updateEndDate`（二选一，不可同时）** |
| 62 天限制 | 错误码 1006 | V3 文档**未列 1006**，待实测 |

> **规划建议**：F3 采集器**优先实现 V3**；v1 文档保留作对照，不必双实现。

#### 2B.2 必填参数（日期组二选一）

| 参数 | 说明 |
|------|------|
| `source` | `"ultrainfluence"` |
| `token` | API Token |
| **组 A：交易发生区间** | `beginDate` + `endDate`（`YYYY-MM-DD`，≥ 2023-01-01） |
| **组 B：更新/验证区间** | `updateBeginDate` + `updateEndDate`（`YYYY-MM-DD`） |

> 错误码 **30233**：必须提供 A 或 B 之一；**30234**：不能同时提供 A 和 B；**30235**：update 区间必须成对。

ZJADS 日常采集用 **组 A**（与结算按订单发生日一致）；按验证日增量同步可用 **组 B**（可选）。

#### 2B.3 可选参数

| 参数 | 说明 |
|------|------|
| `dataScope` | `channel`（默认）或 `user` |
| `curPage` / `perPage` | 分页，max **2000** |

#### 2B.4 请求示例

```json
POST https://api.ultrainfluence.com/api/transaction_v3
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "beginDate": "2025-01-01",
  "endDate": "2025-05-02",
  "updateBeginDate": "",
  "updateEndDate": "",
  "curPage": 1,
  "perPage": 20
}
```

#### 2B.5 响应结构（订单 + items）

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total": 44,
    "curPage": 1,
    "totalPage": 3,
    "hasNext": true,
    "list": [
      {
        "oid": "ny12710_114c999c6853e3a4790e5bec04803135",
        "mid": 8000647,
        "mcid": "nydj",
        "merchant_name": "NYDJ",
        "offer_type": "CPS",
        "order_id": "1271028",
        "ori_order_time": 1707401639,
        "order_time": "2024-02-08 22:13:59",
        "uid": "access202401659527",
        "click_ref": "ev_5s5",
        "items": [
          {
            "ultrainfluence_id": "a0a080f42e6f13b3a2df133f073095dd",
            "skuid": "ny12710_2cf2933837edb364d301dac53c83f0ed",
            "sale_amount": "0",
            "sale_comm": "0",
            "status": "Rejected",
            "prod_id": "889982520597",
            "order_unit": "1",
            "comm_rate": "70.001",
            "validation_date": null,
            "note": null,
            "payment_id": "0",
            "settlement_id": null,
            "settlement_date": null,
            "paid_date": null
          }
        ]
      }
    ]
  }
}
```

> ⚠️ V3 中 `sale_amount` / `sale_comm` 可能为**字符串**，normalize 时需 `Number()`。

#### 2B.6 订单级字段（`list[]`）

| 字段 | 说明 |
|------|------|
| `oid` | 唯一 Order ID（平台侧） |
| `mid` | MID / Brand ID 数字（样例 **8000647**）→ **建议作 merchantId** |
| `mcid` | 品牌 slug |
| `merchant_name` | 品牌名 |
| `offer_type` | 如 `CPS` |
| `order_id` | 商家订单号 |
| `ori_order_time` | 原始交易时间 Unix |
| `order_time` | 交易时间字符串 `YYYY-MM-DD HH:mm:ss` |
| `uid` | 追踪变量 |
| `click_ref` | Unique Click Id |

#### 2B.7 商品级字段（`items[]`）

| 字段 | 说明 |
|------|------|
| `ultrainfluence_id` | 系统唯一 ID（可作 externalOrderId） |
| `skuid` | SKU 唯一 ID |
| `sale_amount` / `sale_comm` | 金额（可能为 string） |
| `status` | **`Pending` / `Rejected`**（样例已确认） |
| `prod_id` | 商品 ID |
| `order_unit` | 件数 |
| `comm_rate` | 佣金率 |
| `validation_date` | 验证时间 |
| `note` | 状态原因 |
| `payment_id` | 关联付款（样例 `"0"` 表示无） |
| `settlement_id` | 关联批准批次 |
| `settlement_date` / `paid_date` | 批准 / 已付日期 |

#### 2B.8 错误码

| code | 含义 |
|------|------|
| `0` | Success |
| `1000` | Publisher does not exist |
| `1001` | Invalid token |
| `10001` | Missing required parameters or incorrect format |
| `30212` | Transaction period must both（起止必须成对） |
| `30233` | Either transaction period or update period is mandatory |
| `30234` | Either transaction period or update period **not both** |
| `30235` | Update period must both |

#### 2B.9 F3 normalize 映射（V3 定稿草案）

| ZJADS `NormalizedOrder` | V3 来源 |
|---------------------------|---------|
| `externalOrderId` | `ultrainfluence_id` 或 `oid|skuid` |
| `merchantId` | `String(mid)`，为 0 时 fallback `mcid` |
| `merchantName` | `merchant_name` / `mcid` |
| `merchantSlug` | `mcid` |
| `productId` | `prod_id` |
| `orderAmount` | `items[].sale_amount` |
| `commission` | `items[].sale_comm` |
| `rawStatus` | `items[].status` |
| `orderDate` | **`order_time` 字符串日期部分**（UTC+8 自然日） | 复用 `parseAffiliateOrderDateUtc8()`；`ori_order_time` 作交叉校验 |
| `rawPayload` | 订单 + item 合并 JSON |

**展开规则**：每个 `list[].items[]` 生成一条 `NormalizedOrder`（与 PM `items` 展开一致）。

---

| 项目 | 内容 |
|------|------|
| 文档 | [Click Report API v1.0](https://app.ultrainfluence.com/tools/apis/click_report/57)（2026/03/03 新增） |
| 用途 | Pull detailed click log（刷量/换链监控；ZJADS 写入 `affiliate_merchant_click_daily`，**不参与 Google 广告 CR**） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/click_report` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

#### 3.1 必填参数

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| `beginDate` | `YYYY-MM-DD HH:mm:ss`；数据最早 **2023-01-01** |
| `endDate` | `YYYY-MM-DD HH:mm:ss` |

> ⚠️ **与 Transaction API 不同**：日期带**时分秒**，且单次区间 **≤ 1 小时**（错误码 1011）。

#### 3.2 可选参数

| 参数 | 说明 |
|------|------|
| `dataScope` | `"channel"`（默认）或 `"user"`（建议与订单一致用 `user`） |
| `curPage` | 当前页 |
| `perPage` | 每页条数，max **2000** |

#### 3.3 请求示例

```json
POST https://api.ultrainfluence.com/api/click_report
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "dataScope": "user",
  "beginDate": "2025-05-10 15:00:00",
  "endDate": "2025-05-10 16:00:00",
  "curPage": 1,
  "perPage": 100
}
```

#### 3.4 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total_page": 1,
    "total_items": 1,
    "list": [
      {
        "click_time": "2024-05-11 09:55:22",
        "mcid": "100percentpure",
        "brand_id": "0",
        "merchant_name": null,
        "channel_id": "MCZCG08000006",
        "uid": "tag1",
        "click_ref": "ev_5t68"
      }
    ]
  }
}
```

> 注意：分页字段为 `total_page` / `total_items`（Transaction API 用 `totalPage` / `hasNext`，**命名不一致**）。

#### 3.5 `list[]` 字段

| 字段 | 说明 |
|------|------|
| `click_time` | 点击时间，**UTC+8** 时区，格式 `YYYY-MM-DD HH:mm:ss` |
| `brand_id` | Brand ID（示例 `"0"`，文档称如 `66303`） |
| `mcid` | 品牌 slug（如 `100percentpure`） |
| `merchant_name` | 品牌名，可为 null |
| `channel_id` | Channel ID |
| `uid` | 自定义追踪变量（SubID / tag） |
| `click_ref` | Unique transaction reference identification |

#### 3.6 错误码

| code | 含义 | 采集器处理建议 |
|------|------|----------------|
| `0` | Success | 正常 |
| `1000` | Publisher does not exist | 凭证错误 |
| `1001` | Invalid token | 凭证错误 |
| `1011` | **Start/end 跨度不能超过 1 小时** | 按小时切片（与 PM 相同） |
| `1012` | **每分钟最多 10 次请求** | 限速 ≥6s/次 或批量控频 |
| `10001` | Missing required parameters or incorrect format | 参数校验 |

#### 3.7 与 PartnerMatic Click Report 对比

| 维度 | PartnerMatic | UltraInfluence |
|------|--------------|----------------|
| URL | `api.partnermatic.com/api/click_report` | `api.ultrainfluence.com/api/click_report` |
| 时间格式 | `YYYY-MM-DD HH:mm:ss` | 相同 |
| 区间上限 | ≤ 1 小时 | ≤ 1 小时（1011） |
| 频率 | 文档未强调 | **10 req/min**（1012） |
| 时区 | PM 实现按本地解析 | 文档明确 **UTC+8** |
| 汇总键 | merchantId + clickDate | 建议 `brand_id`/`mcid` + `click_time` 日期部分 |

> **实现时可 largely 参考** `partnermatic-clicks.ts` 的 `buildPmHourlySlots` + 按商家+日聚合逻辑；改 Base URL 与 `source`，并处理 **1012 限速**。

#### 3.8 写入 ZJADS 映射草案（**待确认**）

| ZJADS `affiliate_merchant_click_daily` | Click Report 字段 | 说明 |
|----------------------------------------|-------------------|------|
| `merchantId` | `brand_id` 或 `mcid` | 与订单 F3 规则保持一致 |
| `merchantName` | `merchant_name` / `mcid` | |
| `clickDate` | `click_time` 的日期部分 | UTC+8 自然日 |
| `clicks` | 按 merchantId+clickDate **计数** list 行数 | 每条 log 计 1 点击 |

### 4. Monetization API（商家目录 / 推广链接）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Monetization API v1.0](https://app.ultrainfluence.com/tools/apis/monetization_api/56)（2026/03/03 新增） |
| 用途 | 查询已加入品牌详情、佣金率、**推广 tracking 链接**（monetize traffic） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/monetization` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

#### 4.1 必填参数

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |

#### 4.2 可选参数（Filter）

| 参数 | 说明 |
|------|------|
| `approval_type` | 按 approval 类型筛选 |
| `offer_type` | 品牌定价模型（样例 `CPS`） |
| `relationship` | 品牌关系（样例 `Joined`） |
| `categories` | 品类；**含特殊字符需 URL 编码** |
| `country` | 两国字母码，如 `US`、`UK` |
| `mid` | Merchant ID，逗号分隔，**最多 200 个**（文档标注 **Deprecated，未来移除**） |
| `mcid` | mcid，逗号分隔，**最多 200 个** |
| `curPage` | 当前页 |
| `perPage` | 每页条数，max **2000** |

#### 4.3 请求示例

```json
POST https://api.ultrainfluence.com/api/monetization
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "approval_type": "",
  "offer_type": "",
  "relationship": "",
  "categories": "",
  "country": "",
  "curPage": 1,
  "perPage": 10
}
```

#### 4.4 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total_mcid": 2,
    "total_page": 1,
    "limit": 10,
    "list": [ { /* 见下表 */ } ]
  }
}
```

#### 4.5 `list[]` 字段（Return parameters + 样例补充）

| 字段 | 类型/示例 | 说明 |
|------|-----------|------|
| `brand_id` | number | Brand ID（样例 **1896**、**1897**）— **建议作为 ZJADS merchantId** |
| `mcid` | string | 品牌 slug（样例 `julep`、`laurageller`） |
| `mid` | number | **Deprecated**，与 `brand_id` 同值，未来移除 |
| `merchant_name` | string | 品牌名（Julep、Laura Geller） |
| `comm_rate` | string | 如 `Rev. Share:65.00%` |
| `comm_detail` | string \| null | 佣金详情 |
| `site_url` | string | 品牌官网 |
| `logo` | string \| null | Logo URL |
| `categories` | string | 如 `Health & Beauty>Bath & Body` |
| `tags` | string \| null | 子类/关键词 |
| `offer_type` | string | 如 `CPS` |
| `network_partner` | string \| null | 联盟网络 |
| `avg_payment_cycle` | number | 平均结算周期（天），样例 90 |
| `avg_payout` | string | 平均 payout 比率 |
| `country` | string | 如 `US` |
| `support_region` | string | 如 `US,PR` |
| `brand_status` | string | `Online` / `Offline` |
| `merchant_status` | string | 样例 `Online`（响应样例有，Return 表未列全） |
| `datetime` | number | Unix 时间戳（加入/移除程序时间） |
| `relationship` | string | 如 `Joined` |
| `tracking_url` | string \| null | 推广链接 |
| `tracking_url_short` | string \| null | 短链（Return 表有） |
| `tracking_url_smart` | string \| null | Smart link（Return 表有） |
| `RD` | string | Cookie 时长（样例 `30.00` 天） |
| `site_desc` | string | 品牌描述 |
| `filter_words` | string \| null | |
| `currency_name` | string \| null | 跟踪币种 |
| `allow_sml` | string | 是否 Deep link（样例 `Y`） |
| `post_area_list` | string[] | 配送国家 |
| `rep_name` / `rep_email` | string \| null | 品牌联系人 |
| `support_couponordeal` | string | Coupon/Deal 流量：`1`/`0`/`-` |
| `mlink_hash` | string | 样例有，文档 Return 表未列 |
| `brand_type` | string \| null | 样例有 |
| `is_direct` | number | 样例 `0` |

#### 4.6 错误码

| code | 含义 |
|------|------|
| `0` | Success |
| `10001` | Missing required parameters or incorrect format |

> 文档仅列上述两码；无 62 天/1 小时类限制（全量拉商家列表，按页分页即可）。

#### 4.7 对 ZJADS 的关键价值

1. **确认 merchantId 规则**：样例中 `brand_id` = `mid` = **数字**（1896/1897），与 Google 系列名末尾数字 ID 格式一致 → **强烈建议 F3/F6/F8 统一用 `String(brand_id)`，为 0 时 fallback `mcid`**
2. **商家名补全**：Transaction 中 `merchant_name` 可为 null，可从 Monetization 缓存补全
3. **可选能力**：推广链接 `tracking_url*`（ZJADS 当前无 PM 同类功能，**非 P0**）
4. **Sheet 校验（F11）**：系列名 merchantId 是否存在于已 Joined 品牌列表

### 5. Commission Validation API（已批准佣金汇总）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Commission Validation API v1.0](https://app.ultrainfluence.com/tools/apis/Commission%20Validation%20API/58)（2026/03/03 新增） |
| 用途 | 按品牌拉取 **已批准（approved）佣金** 的 breakdown；粒度为 **monthly granular level**（文档 Summary） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/commission_validation` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

> 与 **Transaction API** 区别：Transaction 是**订单级**（Pending/Approved 等）；本 API 是**结算批次级**（`settlement_id` + `settlement_date` + 汇总 `sale_comm`）。

#### 5.1 必填参数

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| `beginDate` | `YYYY-MM-DD` |
| `endDate` | `YYYY-MM-DD` |

#### 5.2 请求示例

```json
POST https://api.ultrainfluence.com/api/commission_validation
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "beginDate": "2023-05-01",
  "endDate": "2023-06-01"
}
```

#### 5.3 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "list": [
      {
        "brand_id": 2080,
        "mcid": "feelgoodcontacts",
        "sale_comm": 164.19,
        "settlement_date": "2024-05-22",
        "note": "2024-03-01 ~ 2024-03-31, nydj产出业绩",
        "settlement_id": "d5f22d7b2687a4c220240522"
      },
      {
        "brand_id": 0,
        "mcid": null,
        "sale_comm": 400,
        "settlement_date": "2024-06-06",
        "note": "112312",
        "settlement_id": "9b2a3317bdd15e8c20240606"
      }
    ]
  }
}
```

> 文档**未提及分页**（无 `curPage` / `total_page`）；响应为 `data.list` 数组一次性返回。

#### 5.4 `list[]` 字段

| 字段 | 说明 |
|------|------|
| `brand_id` | Brand ID（样例 2080；可为 0） |
| `mcid` | 品牌 slug（可为 null） |
| `sale_comm` | 该结算批次的佣金金额 |
| `settlement_date` | 佣金批准、可提现日期 `YYYY-MM-DD` |
| `note` | 金额所属时间段/类型说明（如 `2024-03-01 ~ 2024-03-31`；可为 bonus / paid placement） |
| `settlement_id` | 商家已批准佣金的唯一 ID |

#### 5.5 错误码

| code | 含义 | 处理建议 |
|------|------|----------|
| `0` | Success | 正常 |
| `1000` | Publisher does not exist | 凭证错误 |
| `1001` | Invalid token | 凭证错误 |
| `1006` | Query time span cannot exceed **62 days** | 按 62 天切分（同 Transaction） |
| `10001` | Missing required parameters or incorrect format | 参数校验 |

#### 5.6 对 ZJADS 的用途（**非 P0**）

| 场景 | 说明 |
|------|------|
| **F14 对账** | 将 `affiliate_orders` 中 `normalizedStatus=approved` 按区间汇总，与 UI 后台 `commission_validation` 按 `brand_id` 比对 |
| 与 F3 关系 | F3 仍为主数据源；本 API 用于**财务/结算二次校验**，不替代订单采集 |
| `settlement_date` | 可对齐 ZJADS「确认佣金」时间维度（待业务确认用 `order_date` 还是 `validation_date`） |
| `brand_id=0` | 与 Transaction 一致，需 fallback / 单独归类 |

### 6. Commission Details API（结算批次 → 订单明细）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Commission Details API v1.0](https://app.ultrainfluence.com/tools/apis/Details%20API/53)（2024/03/03 新增） |
| 用途 | 用 **`settlementId`** 拉取该批次下按交易的佣金 breakdown（per brand） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/commission_details` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

> **API 链**：Commission Validation（F14）得 `settlement_id` → Commission Details（F9）得该批次内各 `order_id` 明细。

#### 6.1 必填参数

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| `settlementId` | Commission Validation 返回的 `settlement_id` |

#### 6.2 请求示例

```json
POST https://api.ultrainfluence.com/api/commission_details
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "settlementId": "d5f22d7b2687a4c220240522"
}
```

#### 6.3 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": [
    {
      "brand_id": 8000647,
      "mcid": "nydj",
      "merchant_name": "NYDJ",
      "order_id": "5771199185193",
      "order_time": 1710743109,
      "sale_amount": 319,
      "sale_comm": 26.79,
      "status": "Approved",
      "uid": "access202401492030",
      "prod_id": "MW-SC01_8165977456937_46807600496937",
      "order_unit": 1,
      "settlement_id": "d5f22d7b2687a4c220240522",
      "validation_date": "2024-05-22 15:33:43",
      "note": null
    }
  ]
}
```

> ⚠️ **`data` 为数组**，不是 `data.list`（与 Transaction / Validation 不同）。

#### 6.4 `data[]` 字段

| 字段 | 说明 |
|------|------|
| `brand_id` | Brand ID（样例 **8000647**） |
| `mcid` | 品牌 slug（样例 `nydj`） |
| `merchant_name` | 品牌名 |
| `order_id` | 订单 ID |
| `order_time` | 交易时间 Unix 秒 |
| `sale_amount` | 销售额 |
| `sale_comm` | 佣金 |
| `status` | 佣金状态（样例 **`Approved`**） |
| `uid` | 自定义追踪变量 |
| `prod_id` | 商品 ID |
| `order_unit` | 件数 |
| `settlement_id` | 与请求 `settlementId` 一致 |
| `validation_date` | 验证时间 `YYYY-MM-DD HH:mm:ss` |
| `note` | 状态变更原因 |

#### 6.5 样例数据校验（与 Validation API 衔接）

用户样例 6 笔 NYDJ 订单 `sale_comm` 合计：**26.79×2 + 25.95×3 + 32.76 = 164.19**，与 Commission Validation 样例中 `note` 含「nydj产出业绩」的 **`sale_comm: 164.19`** 一致 → 可验证 **Validation 汇总 = Details 明细之和**。

#### 6.6 错误码

| code | 含义 | 备注 |
|------|------|------|
| `0` | Success | |
| `1000` | Publisher does not exist | |
| `1001` | Invalid token | |
| `1002` | Call frequency too high | 建议限速 |
| `1004` | Query time span cannot exceed 62 days | 本 API 仅传 `settlementId`，**可能为文档模板残留** |
| `10001` | Missing required parameters or incorrect format | |

#### 6.7 对 ZJADS 的用途（**非 P0**）

| 场景 | 说明 |
|------|------|
| **F9 佣金 breakdown** | 对已批准结算批次，按 `order_id`+`prod_id` 展开；可写入 `_commissionBreakdown` 或仅对账脚本使用 |
| **F14 下钻** | Validation 发现差异时，用 Details 定位具体订单 |
| **F4 状态** | 样例确认存在 **`Approved`** 状态（首字母大写） |
| **与 F3 关系** | 订单字段与 Transaction API **高度重叠**；F3 仍为主采集，Details 用于**已结算批次**核对或补状态 |

#### 6.8 字段映射（Details → ZJADS，对账/可选回填）

| ZJADS | Commission Details 字段 |
|-------|---------------------------|
| `externalOrderId` | `order_id` + `prod_id` |
| `merchantId` | `brand_id`（字符串） |
| `merchantName` | `merchant_name` |
| `orderAmount` | `sale_amount` |
| `commission` | `sale_comm` |
| `rawStatus` | `status` |
| `orderDate` | `order_time` 或 `validation_date`？（对账用 validation；报表用 order_time — 待确认） |

### 7. Payment Summary API（付款历史汇总）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Payment Summary API v1.0](https://app.ultrainfluence.com/tools/apis/payment_summary_api/55)（2026/03/03 新增） |
| 用途 | 查询 **Payment History**（平台已向 Publisher 打款记录） |
| 接口 URL | `POST https://api.ultrainfluence.com/api/payment_summary` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

> 与 **F3/F14** 区别：F3/F14 是**佣金订单/结算批次**；本 API 是**实际打款（paid）**记录，用于财务「钱是否到账」。

#### 7.1 必填参数（二选一）

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| **方式 A** | `paymentId` — 指定单笔付款 ID |
| **方式 B** | `paidDateBegin` + `paidDateEnd` — 打款日区间，`YYYY-MM-DD` |

> 文档表述为 `paymentId` **或** `paid_date_begin` + `paid_date_end`；请求示例使用 camelCase **`paidDateBegin` / `paidDateEnd`**（与其它 UI API 一致）。

#### 7.2 可选参数

| 参数 | 说明 |
|------|------|
| `curPage` | 当前页 |
| `perPage` | 每页条数，max **2000** |

#### 7.3 请求示例

```json
POST https://api.ultrainfluence.com/api/payment_summary
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "paidDateBegin": "2025-05-01",
  "paidDateEnd": "2025-06-01",
  "curPage": 1,
  "perPage": 20
}
```

#### 7.4 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total_items": 1,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "payment_id": 36500,
        "request_date": "2024-08-27 13:52:24",
        "paid_date": "2024-09-18 15:33:30",
        "payment_type": "Paypal",
        "payment_details": "admintest@cz.com",
        "invoice": null,
        "amount": 109.01,
        "status": "paid"
      }
    ]
  }
}
```

> 分页字段：`total_items` / `page` / `limit` / `list`（与 Transaction 的 `totalPage`/`hasNext` 又不同，实现时注意）。

#### 7.5 `list[]` 字段

| 字段 | 说明 |
|------|------|
| `payment_id` | 付款 ID（Payment History 中可见） |
| `request_date` | 付款创建时间（样例含 `HH:mm:ss`；Return 表亦写 `YYYY-MM-DD`） |
| `paid_date` | 标记已付款时间 |
| `payment_type` | 付款方式（样例 `Paypal`） |
| `payment_details` | 账户信息（样例邮箱） |
| `invoice` | 发票信息，可为 null |
| `amount` | 付款金额 |
| `status` | 处理状态（样例 **`paid`**） |

#### 7.6 错误码

| code | 含义 |
|------|------|
| `0` | Success |
| `1000` | Publisher does not exist |
| `1001` | Invalid token |
| `1002` | Call frequency too high |
| `1003` | Missing required parameters or incorrect format |

> 注意：其它 API 常用 `10001` 表示参数错误，此处为 **`1003`**。

#### 7.7 对 ZJADS 的用途（**非 P0**）

| 场景 | 说明 |
|------|------|
| **F10 提现/打款对账** | 按 `paidDateBegin/End` 拉付款列表，与内部结算/财务记录比对 |
| **与 Payment Detail 关系** | Summary 得 `payment_id` → **`payment_detail`** 下钻每笔构成 ✅ |
| **与 F14 关系** | F14 是「佣金批准」；F10 是「平台已打款」— 时间线更后 |
| **ZJADS 现状** | 无 PM 同类「打款历史」页；可先 **diag 脚本**，不做员工可见功能 |

### 8. Payment Detail API（付款明细）— **已记录**

| 项目 | 内容 |
|------|------|
| 文档 | [Payment Detail API v1.0](https://app.ultrainfluence.com/tools/apis/payment_detail_api/54)（2026/03/03 新增） |
| 用途 | 查询 **Detailed Payment** — 每笔打款由哪些 commission/bonus 构成 |
| 接口 URL | `POST https://api.ultrainfluence.com/api/payment_detail` |
| 返回格式 | JSON |
| 成功标识 | `code === "0"` |

> **API 链**：Payment Summary（F10）得 `payment_id` + `amount` → Payment Detail 展开 `list[]` 各行（含 `settlement_id` 链回 F14/F9）。

#### 8.1 必填参数（二选一，同 Summary）

| 参数 | 说明 |
|------|------|
| `source` | 固定 `"ultrainfluence"` |
| `token` | API Token |
| **方式 A** | `paymentId` — 单笔付款 ID（样例 `123` 或 `36500`） |
| **方式 B** | `paidDateBegin` + `paidDateEnd` — 打款日 `YYYY-MM-DD` |

#### 8.2 可选参数

| 参数 | 说明 |
|------|------|
| `validationDateBegin` | 验证日区间起 `YYYY-MM-DD` |
| `validationDateEnd` | 验证日区间止 |
| `curPage` | 当前页 |
| `perPage` | 每页 max **2000** |

#### 8.3 请求示例

```json
POST https://api.ultrainfluence.com/api/payment_detail
Content-Type: application/json

{
  "source": "ultrainfluence",
  "token": "<token>",
  "paymentId": 36500,
  "paidDateBegin": "",
  "paidDateEnd": "",
  "validationDateBegin": "",
  "validationDateEnd": "",
  "curPage": 1,
  "perPage": 20
}
```

#### 8.4 响应结构

```json
{
  "code": "0",
  "message": "success",
  "data": {
    "total_items": 1,
    "page": 1,
    "limit": 20,
    "list": [
      {
        "brand_id": 0,
        "mcid": null,
        "amount": 109.01,
        "validation_date": "2024-05-30",
        "type": "CPS Commission",
        "note": "2023-05-16 这是一个用户其它产生1",
        "settlement_id": "634325519978074112",
        "merchant_name": null,
        "sign_id": "0cd43a7c0dcb1c8bd56a1c4a85533b3f",
        "date": "05-30-2024",
        "payment_id": 36500,
        "paid_date": "2024-09-18 15:33:30"
      }
    ]
  }
}
```

> 样例 `amount: 109.01`、`payment_id: 36500` 与 Payment Summary 样例**完全一致** → Summary 总额 = Detail 行之和（单行时）。

#### 8.5 `list[]` 字段

| 字段 | 说明 |
|------|------|
| `brand_id` | Brand ID（可为 0） |
| `mcid` | 品牌 slug（可为 null） |
| `amount` | 佣金或 bonus 金额 |
| `validation_date` | 佣金批准日 `YYYY-MM-DD` |
| `type` | `commission` / `bonus`（样例 `"CPS Commission"`） |
| `note` | 金额所属时间段说明 |
| `settlement_id` | 关联 Commission Validation 批次 ID |
| `merchant_name` | 品牌名 |
| `payment_id` | 所属付款 ID |
| `paid_date` | 标记已付款时间 |
| `sign_id` | 记录唯一 ID |
| `date` | 样例有 `05-30-2024`（Return 表未列，实现时保留 rawPayload） |

#### 8.6 错误码

| code | 含义 |
|------|------|
| `0` | Success |
| `1000` | Publisher does not exist |
| `1001` | Invalid token |
| `1002` | Call frequency too high |
| `1003` | Missing required parameters or incorrect format |
| `1012` | **No more than ten requests per minute** |

#### 8.7 对 ZJADS 的用途（**非 P0**）

| 场景 | 说明 |
|------|------|
| **F10 下钻** | Summary 某笔 `payment_id` → Detail 看由哪些 `settlement_id`/商家组成 |
| **跨 API 追溯** | `settlement_id` → F9 `commission_details` → `order_id` 全链路 |
| **限速** | 1012 同 Click Report，建议 ≥6s/次 |

#### 8.8 UltraInfluence 财务 API 全链（记录用）

```
订单:     Transaction API V3 (F3) — 推荐；v1 作对照
              ↓
批准批次: Commission Validation (F14) — settlement_id + sale_comm
              ↓
订单明细: Commission Details (F9) — 按 settlementId
              ↓
打款汇总: Payment Summary (F10) — payment_id + amount
              ↓
打款明细: Payment Detail (F10 下钻) — 每行 settlement_id / brand_id / amount
```

### 9. 订单状态枚举（原始值 → 系统映射）

样例已确认：**`Pending`**、**`Rejected`**（V3）、**`Approved`**（Commission Details）。

| UltraInfluence `status` | ZJADS `normalizedStatus` | 样例来源 |
|-------------------------|--------------------------|----------|
| `Approved` | approved | Commission Details ✅ |
| `Pending` | pending | Transaction v1 / V3 ✅ |
| **`Rejected`** | **rejected** | **Transaction V3 ✅** |
| `Canceled`？ | rejected | 待确认 |

---

## 功能 ↔ API 对照（基于 ZJADS 现有架构）

| # | ZJADS 功能 | 用户可见场景 | 依赖 API | 优先级 | 状态 |
|---|-----------|-------------|----------|--------|------|
| F1 | 平台注册（`platforms` 表 + seed） | 管理员「平台账号」可选 UltraInfluence | 无（配置） | P0 | 可规划 |
| F2 | 员工绑定平台账号（Token） | 平台账号页 | Token；可选 `channel_id` 存 `externalChannelId` | P0 | 可规划 |
| F3 | **订单采集** → `affiliate_orders` | 结算页采集、采集中心 | **Transaction API V3**（推荐）或 v1 | P0 | **API 已齐，建议 V3** |
| F4 | 订单状态标准化 | 结算 pending/confirmed/rejected | F3 的 `items[].status` + 映射表 | P0 | **Pending/Rejected/Approved 已有样例** |
| F5 | 结算页按区间汇总佣金 | 员工结算 | F3 入库数据 | P0 | 依赖 F3 |
| F6 | 商家汇总 / 广告系列报表归因 | 工作台、商家分析 | F3 + Google Sheet；系列名 `ui*`；**merchantId 建议 V3 `mid`（= Monetization `brand_id`）** | P0 | **规则趋明确** |
| F7 | 平台概览 / 管理员统计 | 超管平台统计 | F3 聚合 | P1 | 依赖 F3 |
| F8 | **联盟点击采集** | CR/EPC、刷量监控；**与 UI 后台点击对齐** | **Click Report API** `POST /api/click_report` | **P0** | **API 已齐；对齐硬性要求** |
| F9 | **佣金 breakdown / 结算下钻** | 对账、明细核对 | **Commission Details API**（需 F14 的 `settlementId`） | P2 | **API 已齐** |
| F10 | **提现/打款对账** | 财务 | **Payment Summary** + **Payment Detail API** | P2 | **API 已齐** |
| **F14** | **已批准佣金对账** | 财务 / 运维 diag | **Commission Validation API** | P2 | **API 已齐** |
| F11 | Google MCC Sheet 脚本 | 系列命名 / 商家 ID 校验 | Monetization API（可选缓存 brand 列表） | P2 | Monetization 已齐 |
| F12 | 报表归因去重（`ui` 平台族） | 避免跨平台重复 | 无（代码规则） | P0 | 随 F6 |
| F13 | 商家目录缓存（**ZJADS 暂无同类**） | 商家名补全、ID 校验、推广链接 | **Monetization API** | P2 | **API 已齐，非必须** |

### F3 采集实现要点（写代码时参考，**今不执行**）

**推荐路径：Transaction API V3**

1. 仅用 **`beginDate` + `endDate`**（不传 update 区间）；若遇 30234 确保另一组为空
2. 分页 `curPage` / `perPage: 2000`，`hasNext` 循环（同 v1）
3. **展开** `list[].items[]` → 每条 item 一条 `NormalizedOrder`（参考 PM）
4. `merchantId` = `String(mid)`，`mid===0` → `mcid`
5. `orderDate` = `parseAffiliateOrderDateUtc8(order.order_time)`（字符串即 UTC+8 日；与 UI 后台一致）
6. 若 V3 无 62 天限制，仍建议按 62 天切分；**today + yesterday 每次重采**
7. normalize → `affiliate_orders` upsert；dedupe 订单用 **`oid`**（非 item 行数）

**备选**：v1 `/api/transaction` 逻辑更简单但扁平行，与 V3 字段名不一致，**不建议双轨**。

### F8 点击采集实现要点（写代码时参考，**今不执行**）

1. 将 `[startDate, endDate]`（**UTC+8 日历日**）拆成 **每小时一片**（`beginDate`/`endDate` 带 `HH:mm:ss`）
2. 每片内 `curPage` 分页直到无下一页
3. 遵守 **10 req/min**（1012）：建议片间 sleep ≥6s
4. `clickDate` = `click_time.split(' ')[0]`（UTC+8）→ `affiliate_merchant_click_daily`
5. 按 **merchantId + clickDate** 聚合 list 行数
6. **today 必须纳入每次采集**；与 F3 共用 merchantId 规则（`mid`，0→`mcid`）
7. 无 F8 则「联盟点击」列恒为 0，**验收不通过**

### F13 商家目录（可选，**今不执行**）

1. 定时或按需拉 Monetization 全量 `list`（分页 `perPage: 2000`）
2. 缓存 `brand_id` ↔ `mcid` ↔ `merchant_name` ↔ `relationship`
3. 用于 Transaction normalize 补全商家名；Sheet 脚本校验 merchantId 是否 Joined
4. **不阻塞 P0**：无 F13 时仍可按 F3 单独上线

### F14 已批准佣金对账（可选，**今不执行**）

1. 按 62 天切分调用 `commission_validation`
2. 按 `brand_id` / `settlement_id` 与本地 `affiliate_orders` approved 汇总比对
3. 差异写入 diag 脚本或管理员对账页（ZJADS **暂无现成 UI**，可先脚本）
4. **不替代 F3**：订单采集仍是投手主流程
5. 差异批次可调用 **F9** `commission_details` 下钻到 `order_id`

### F9 结算明细下钻（可选，**今不执行**）

1. 输入：`settlementId`（来自 F14 或手工）
2. 调用 `commission_details` → 得 `data[]` 订单列表
3. 与本地 `affiliate_orders` 按 `order_id`+`prod_id` 逐笔比对
4. 可选：将 Approved 明细回填/校正本地 `normalizedStatus`（**需业务确认是否自动改库**）

### F10 打款历史对账（可选，**今不执行**）

1. 按 `paidDateBegin` / `paidDateEnd` 分页拉 `payment_summary`
2. 汇总 `amount`（`status=paid`）与财务预期比对
3. 单笔差异用 `paymentId` 调 **`payment_detail`** 展开各行
4. 各行 `settlement_id` 可继续调 F9 追溯到 `order_id`
5. 遵守 **1012**（10 req/min）
6. **不影响**投手结算页（F5 仍来自 F3 订单）

---

## 代码改动清单（**同意开发前仅作预估，不执行**）

| 区域 | 文件/位置 | 改动说明 |
|------|-----------|----------|
| 数据库 | `prisma/seed.ts` | 新增 platform + status mappings |
| 采集器 | `collectors/ultrainfluence.collector.ts`（新建） | **Transaction V3** + items 展开；参考 PM |
| 点击 | `collectors/ultrainfluence-clicks.ts`（可选） | 参考 `partnermatic-clicks.ts`；Click Report API |
| 注册 | `collectors.registry.ts` | 加入 `ultrainfluence` |
| 调度 | `collectors.service.ts` | switch 分支 |
| 状态 | `platform-status-defaults.util.ts` | UI 默认映射 |
| 归因 | `campaign-affiliate-attribution.util.ts` | `ui*` 平台族 |
| 系列名 | `campaign-name.util.ts`（api + web） | infer `UltraInfluence` |
| 前端 | `DashboardPage.tsx` 等 | 平台筛选标签 `UI` |
| 文档 | 本文 | |

---

## 待负责人确认的事项

- [ ] platform code：`ultrainfluence` 是否 OK
- [ ] 广告系列前缀：`ui1` / `ui2` …
- [ ] **merchantId 用哪个字段**：V3 用 **`mid`**（= Monetization `brand_id`）；`mid=0` 时 fallback `mcid` — 请最终确认
- [ ] **F3 用 v1 还是 V3**：规划建议 **V3**（见 §2B）
- [ ] **去重键**：V3 优先 `ultrainfluence_id` 或 `oid|skuid`
- [ ] `dataScope` 用 `user` 还是 `channel`（一 Token 一 Channel 时等价）
- [ ] **today 采集频率**（定时任务间隔 vs 手动采集）
- [ ] 是否 P0 必须 Click Report API — **已升为 P0（对齐硬性要求）**
- [ ] **同意开始写代码**（确认日期：____）

---

## 变更日志

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-07-24 | 创建文档 | 建立规划框架 |
| 2026-07-24 | 收录 Transaction API | 文档页、参数、响应样例、错误码、PM 对比、F3 映射 |
| 2026-07-24 | 收录 Click Report API | 1h 分片、10 req/min、UTC+8、F8 映射；与 PM click_report 对齐 |
| 2026-07-24 | 收录 Monetization API | brand_id 数字 ID、F11/F13；merchantId 规则趋明确 |
| 2026-07-24 | 收录 Commission Validation API | 已批准佣金按品牌汇总、F14 对账；62 天限制 |
| 2026-07-24 | 收录 Commission Details API | settlementId 下钻、F9；确认 Approved 状态；与 F14 链式 |
| 2026-07-24 | 收录 Payment Summary API | 打款历史、F10；paidDate 区间或 paymentId |
| 2026-07-24 | 收录 Payment Detail API | F10 下钻、settlement 全链；1012 限速 |
| 2026-07-24 | 收录 Transaction API V3 | 建议 F3 用 V3；mid/items/Rejected；9/9 API 齐全 |
| 2026-07-24 | **数据对齐需求** | 区间+按天对齐 UI/Google；UTC+8 vs 账户时区；F8 升 P0；验收清单 |
| 2026-07-24 | **UI Performance 报表** | All=全状态汇总；分 Tab 才按状态拆；Est. Commission 映射 |
