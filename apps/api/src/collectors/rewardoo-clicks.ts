import axios from 'axios';
import { parseRwPerformanceCalendarDay } from '../common/affiliate-order-date.util';
import {
  forEachRewardooOffsetPage,
  forEachRewardooPageLimit,
  parseRwApiEnvelope,
  RW_API_BASE,
} from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export interface RwMerchantClickAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  clicks: number;
  /** RW Performance 看板 Orders（Transaction Date 口径） */
  performanceOrders: number;
  /** RW Performance 看板 Comm.（Transaction Date 口径） */
  performanceCommission: number;
}

/** RW 点击采集无法归因商家时的占位 ID，报表应忽略 */
export function isRwClickPseudoMerchant(merchantId: string): boolean {
  return merchantId === '__rw_unmatched__';
}

export interface RwClickFetchProgress {
  phase: 'summary' | 'user_click' | 'click_details';
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
  source?: string;
}

interface RwClickRow {
  mid?: string | number;
  m_id?: string | number;
  merchant_id?: string | number;
  merchant_name?: string;
  click_time?: string;
  click_ref?: string;
}

interface RwClickSourceSpec {
  label: string;
  mod: string;
  op: string;
  dateParams: (begin: string, end: string) => Record<string, string>;
  extra?: Record<string, string>;
}

/**
 * 与 LinkBux/RW 后台 Performance 对齐（medium/performance 优先，type=json + page/limit）
 */
const RW_CLICK_SUMMARY_SOURCES: RwClickSourceSpec[] = [
  {
    label: 'medium/performance',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e }),
  },
  {
    label: 'medium/performance CPS',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e, offer_type: 'CPS' }),
  },
  {
    label: 'medium/cpc_performance',
    mod: 'medium',
    op: 'cpc_performance',
    dateParams: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
    }),
  },
  {
    label: 'commission/merchant',
    mod: 'commission',
    op: 'merchant',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/performance',
    mod: 'commission',
    op: 'performance',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/report',
    mod: 'commission',
    op: 'report',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/cpc_performance',
    mod: 'commission',
    op: 'cpc_performance',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'performance/merchant',
    mod: 'performance',
    op: 'merchant',
    dateParams: (b, e) => ({ begin: b, end: e }),
  },
  {
    label: 'performance/report',
    mod: 'performance',
    op: 'report',
    dateParams: (b, e) => ({ begin: b, end: e }),
  },
];

/**
 * Performance 订单数数据源（与 RW 后台 Performance Report 对齐）
 */
const RW_PERFORMANCE_ORDER_SOURCES: RwClickSourceSpec[] = [
  {
    label: 'medium/cpc_performance daily',
    mod: 'medium',
    op: 'cpc_performance',
    dateParams: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
      status: 'All',
    }),
  },
  {
    label: 'medium/performance daily',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
    }),
  },
];

/** RW 文档 CPC Performance API：GET + begin_date / begin_click_date（LinkBux 同系） */
const RW_CPC_PERFORMANCE_GET_VARIANTS: Array<{
  label: string;
  params: (b: string, e: string) => Record<string, string>;
}> = [
  {
    label: 'CPC Performance begin_date',
    params: (b, e) => ({ begin_date: b, end_date: e, status: 'All' }),
  },
  {
    label: 'CPC Performance begin_click_date',
    params: (b, e) => ({ begin_click_date: b, end_click_date: e, status: 'All' }),
  },
  {
    label: 'CPC Performance daily+merchant',
    params: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
      status: 'All',
    }),
  },
  {
    label: 'CPC Performance primary+secondary',
    params: (b, e) => ({
      begin_date: b,
      end_date: e,
      primary: 'day',
      secondary: 'merchant',
      status: 'All',
    }),
  },
];

/** RW 文档 CommissionSummary API（Transaction / Payment 两种日期口径） */
const RW_COMMISSION_SUMMARY_VARIANTS: Array<{
  label: string;
  params: (b: string, e: string) => Record<string, string>;
}> = [
  {
    label: 'CommissionSummary begin_date',
    params: (b, e) => ({ begin_date: b, end_date: e }),
  },
  {
    label: 'CommissionSummary payment',
    params: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
];

/** RW 后台 Performance 按日汇总（账号级，无 merchant_id） */
const RW_ACCOUNT_DAILY_PERFORMANCE_SOURCES: RwClickSourceSpec[] = [
  {
    label: 'performance/report',
    mod: 'performance',
    op: 'report',
    dateParams: (b, e) => ({ begin: b, end: e }),
  },
  {
    label: 'medium/performance',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e }),
  },
];

export interface RwPerformanceFetchOptions {
  /** 按日有佣金的 merchantId，用于 medium/performance + mid */
  merchantsByDate?: Map<string, Set<string>>;
}

/** ClickDetails：60 秒内最多 15 次（文档错误码 1006） */
const RW_CLICK_MIN_INTERVAL_MS = 4100;

const RW_CLICK_PAGE_SIZE = 500;

/** 单次采集最长自然日数 */
const RW_CLICK_MAX_DAYS = 62;

/** 超过此天数不再跑 click_details（168 小时片太慢且多数账号为空） */
const RW_CLICK_DETAILS_MAX_DAYS = 1;

let lastRwClickRequestAt = 0;

/**
 * 采集 Rewardoo 联盟点击。
 * 优先 Performance 汇总接口（page/limit）；仅单日区间才兜底 ClickDetails。
 */
export async function fetchRewardooClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const dayCount = countInclusiveDays_(startDate, endDate);
  if (dayCount > RW_CLICK_MAX_DAYS) {
    throw new Error(
      `RW 点击采集区间过长（${dayCount} 天），请缩短至 ${RW_CLICK_MAX_DAYS} 天内`,
    );
  }

  const agg = new Map<string, RwMerchantClickAgg>();

  if (
    await trySummarizedClickSources_(
      apiToken,
      startDate,
      endDate,
      agg,
      onProgress,
    )
  ) {
    return Array.from(agg.values());
  }

  if (await fetchRwUserClickAggs_(apiToken, startDate, endDate, agg, onProgress)) {
    return Array.from(agg.values());
  }

  if (dayCount <= RW_CLICK_DETAILS_MAX_DAYS) {
    await fetchClickDetailsAggs_(apiToken, startDate, endDate, agg, onProgress);
  }

  return Array.from(agg.values());
}

/**
 * RW 后台 Performance Report 数据源（CPS 商家）
 * 优先 CommissionSummary + medium/performance(CPS)，CPC Performance 仅最后兜底
 */
export async function fetchRewardooPerformanceSummaryAggs(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  options?: RwPerformanceFetchOptions,
): Promise<RwMerchantClickAgg[]> {
  return fetchRwPerformanceDaily_(
    apiToken,
    startDate,
    endDate,
    onProgress,
    options?.merchantsByDate,
  );
}

/**
 * 快速拉取 RW 点击/Performance（整段区间单次请求，避免逐日多源拖慢采集）
 */
export async function fetchRewardooClicksQuick(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const spec = RW_CPS_DAILY_SOURCES[0];
  await fetchClickSource_(
    spec,
    apiToken,
    startDate,
    endDate,
    agg,
    startDate,
    endDate,
    undefined,
    { rwPerformanceDaily: true },
  );
  return [...agg.values()];
}

/** 账号级按日 Performance 指标（无 merchant_id 的汇总行） */
interface RwAccountDailyMetrics {
  orders: number;
  clicks: number;
}

/** 合并单条商家日指标到 Map（取各字段最大值） */
function mergeRwAggRow_(
  agg: Map<string, RwMerchantClickAgg>,
  row: RwMerchantClickAgg,
): void {
  const key = `${row.merchantId}|${row.clickDate}`;
  const existing = agg.get(key);
  if (!existing) {
    agg.set(key, { ...row });
    return;
  }
  existing.clicks = Math.max(existing.clicks, row.clicks);
  existing.performanceOrders = Math.max(existing.performanceOrders, row.performanceOrders);
  existing.performanceCommission = Math.max(
    existing.performanceCommission,
    row.performanceCommission,
  );
  if (!existing.merchantName && row.merchantName) {
    existing.merchantName = row.merchantName;
  }
}

/** 从 merchantIds 构建按日商家索引（供账号级 orders/clicks 归因） */
function buildMerchantsByDateFromIds_(
  merchantIds: string[],
  startDate: string,
  endDate: string,
): Map<string, Set<string>> {
  const ids = merchantIds.filter((id) => id.trim() !== '');
  if (ids.length === 0) return new Map();

  const map = new Map<string, Set<string>>();
  for (const dateStr of listInclusiveDates_(startDate, endDate)) {
    map.set(dateStr, new Set(ids));
  }
  return map;
}

function sumAccountDailyOrders_(map: Map<string, RwAccountDailyMetrics>): number {
  let total = 0;
  for (const m of map.values()) total += m.orders;
  return total;
}

function sumAccountDailyClicks_(map: Map<string, RwAccountDailyMetrics>): number {
  let total = 0;
  for (const m of map.values()) total += m.clicks;
  return total;
}

/** 账号级按日 orders/clicks 归因到商家（单商家直接映射） */
function attributeAccountDailyPerformanceMetrics_(
  accountDaily: Map<string, RwAccountDailyMetrics>,
  merchantsByDate?: Map<string, Set<string>>,
): RwMerchantClickAgg[] {
  if (!merchantsByDate || merchantsByDate.size === 0) return [];

  const allMerchants = new Set<string>();
  for (const mids of merchantsByDate.values()) {
    for (const mid of mids) allMerchants.add(mid);
  }

  const out: RwMerchantClickAgg[] = [];

  if (allMerchants.size === 1) {
    const merchantId = [...allMerchants][0]!;
    for (const [clickDate, metrics] of accountDaily) {
      if (metrics.orders <= 0 && metrics.clicks <= 0) continue;
      out.push({
        merchantId,
        merchantName: '',
        clickDate,
        clicks: metrics.clicks,
        performanceOrders: metrics.orders,
        performanceCommission: 0,
      });
    }
    return out;
  }

  for (const [clickDate, metrics] of accountDaily) {
    if (metrics.orders <= 0 && metrics.clicks <= 0) continue;
    const mids = merchantsByDate.get(clickDate);
    if (!mids || mids.size !== 1) continue;
    const merchantId = [...mids][0]!;
    out.push({
      merchantId,
      merchantName: '',
      clickDate,
      clicks: metrics.clicks,
      performanceOrders: metrics.orders,
      performanceCommission: 0,
    });
  }

  return out;
}

/** 拉取账号级 Performance Daily（与 RW 后台 Group by Daily 一致） */
async function fetchAccountDailyPerformanceMetrics_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<Map<string, RwAccountDailyMetrics>> {
  const accountDaily = new Map<string, RwAccountDailyMetrics>();
  const sources: RwClickSourceSpec[] = [
    {
      label: 'performance/report daily',
      mod: 'performance',
      op: 'report',
      dateParams: (b, e) => ({ begin: b, end: e, group_by: 'day' }),
    },
    ...RW_ACCOUNT_DAILY_PERFORMANCE_SOURCES,
    {
      label: 'medium/performance CPS daily',
      mod: 'medium',
      op: 'performance',
      dateParams: (b, e) => ({
        begin_date: b,
        end_date: e,
        offer_type: 'CPS',
        dimension: 'day',
      }),
    },
  ];

  for (const spec of sources) {
    const ordersBefore = sumAccountDailyOrders_(accountDaily);
    const clicksBefore = sumAccountDailyClicks_(accountDaily);
    await fetchClickSource_(
      spec,
      apiToken,
      startDate,
      endDate,
      new Map(),
      startDate,
      endDate,
      undefined,
      {
        performanceOrdersOnly: true,
        accountDailyMetrics: accountDaily,
      },
    );
    const ordersAfter = sumAccountDailyOrders_(accountDaily);
    const clicksAfter = sumAccountDailyClicks_(accountDaily);
    if (ordersAfter > ordersBefore || clicksAfter > clicksBefore) {
      await onProgress?.(
        `Performance ${spec.label} 账号按日 → ${ordersAfter} 单 / ${clicksAfter} 点击`,
      );
      return accountDaily;
    }
  }

  return accountDaily;
}

/** 区间一次拉取 CPS Performance（避免逐日循环拖慢采集） */
async function trySourcesRwPerformanceRange_(
  apiToken: string,
  startDate: string,
  endDate: string,
  mid: string | undefined,
  dayAgg: Map<string, RwMerchantClickAgg>,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<boolean> {
  for (const spec of RW_CPS_DAILY_SOURCES) {
    const ordersBefore = sumAggPerformanceOrders_(dayAgg);
    const clicksBefore = sumAggClicks_(dayAgg);
    const extraMid = mid ? rwMidParams_(mid) : {};
    const specWithMid: RwClickSourceSpec = {
      ...spec,
      dateParams: (b, e) => ({ ...spec.dateParams(b, e), ...extraMid }),
    };
    if (
      await fetchClickSource_(
        specWithMid,
        apiToken,
        startDate,
        endDate,
        dayAgg,
        startDate,
        endDate,
        undefined,
        { rwPerformanceDaily: true, forcedMid: mid },
      )
    ) {
      if (
        sumAggPerformanceOrders_(dayAgg) > ordersBefore ||
        sumAggClicks_(dayAgg) > clicksBefore
      ) {
        await onProgress?.(`${spec.label} 区间汇总已解析 orders/clicks`);
        return true;
      }
    }
  }
  return false;
}

export interface RwPerformanceDailyAggsOptions {
  /** 按日有佣金的 merchantId（用于账号级 orders/clicks 归因） */
  merchantsByDate?: Map<string, Set<string>>;
  /** 为 false 时仅补 orders，不跑点击兜底（user_click / fetchRewardooClicks） */
  includeClicks?: boolean;
}

/**
 * 拉取 performance/report 区间按日汇总（与 RW 后台 Group by Daily 一致）
 */
async function tryFetchPerformanceReportDaily_(
  apiToken: string,
  startDate: string,
  endDate: string,
  merchantIds: string[],
  merchantsByDate: Map<string, Set<string>>,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const paramVariants: Record<string, string>[] = [
    { begin: startDate, end: endDate, group_by: 'day' },
    { begin: startDate, end: endDate },
    { begin_date: startDate, end_date: endDate, group_by: 'day' },
  ];

  for (const params of paramVariants) {
    await forEachRewardooGetPage_('performance', 'report', apiToken, params, (rows) => {
      for (const raw of rows) {
        const row = raw as Record<string, unknown>;
        if (isRwTransactionDetailRow_(row)) continue;

        const clickDate = parseRwRowDate_(row) || '';
        if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

        const orders = extractRwPerformanceOrdersFromRow_(row);
        const clicks = extractRwClickCountFromRow_(row);
        if (orders <= 0 && clicks <= 0) continue;

        let merchantId = resolveRwClickMerchantId_(row);
        if (!merchantId) {
          const midsOnDay = merchantsByDate.get(clickDate);
          if (!midsOnDay || midsOnDay.size !== 1) continue;
          merchantId = [...midsOnDay][0]!;
        }
        if (merchantIds.length > 0 && !merchantIds.includes(merchantId)) continue;

        mergeRwAggRow_(agg, {
          merchantId,
          merchantName: String(row.merchant_name ?? row.advertiser_name ?? ''),
          clickDate,
          clicks,
          performanceOrders: orders,
          performanceCommission: 0,
        });
      }
    });
    if (agg.size > 0) break;
  }

  if (agg.size > 0) {
    await onProgress?.(
      `performance/report 按日 → ${sumAggPerformanceOrders_(agg)} 单 / ${sumAggClicks_(agg)} 点击`,
    );
  }
  return [...agg.values()];
}

/**
 * 按自然日拉取 orders/clicks（多源兜底：CPC Performance / 账号按日 / user_click）
 */
export async function fetchRewardooPerformanceDailyAggs(
  apiToken: string,
  startDate: string,
  endDate: string,
  merchantIds?: string[],
  onProgress?: (message: string) => void | Promise<void>,
  options?: RwPerformanceDailyAggsOptions,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const mids = (merchantIds ?? []).filter((id) => id.trim() !== '');
  const merchantsByDate =
    options?.merchantsByDate ?? buildMerchantsByDateFromIds_(mids, startDate, endDate);
  const includeClicks = options?.includeClicks !== false;
  const needOrders = () => sumAggPerformanceOrders_(agg) === 0;
  const needClicks = () => includeClicks && sumAggClicks_(agg) === 0;
  const needMetrics = () => needOrders() || needClicks();

  /** 1. performance/report 区间按日（最快，与 RW 后台 Group by Daily 一致） */
  if (needMetrics()) {
    const reportRows = await tryFetchPerformanceReportDaily_(
      apiToken,
      startDate,
      endDate,
      mids,
      merchantsByDate,
      onProgress,
    );
    for (const row of reportRows) mergeRwAggRow_(agg, row);
  }

  /** 2. 区间一次拉取（cpc_performance + medium/performance） */
  if (needMetrics()) {
    const rangeAgg = new Map<string, RwMerchantClickAgg>();
    for (const mid of mids.length > 0 ? mids : [undefined as string | undefined]) {
      await trySourcesRwPerformanceRange_(
        apiToken,
        startDate,
        endDate,
        mid,
        rangeAgg,
        onProgress,
      );
    }
    for (const row of rangeAgg.values()) {
      if (mids.length > 0 && !mids.includes(row.merchantId)) continue;
      if (row.performanceOrders <= 0 && row.clicks <= 0) continue;
      mergeRwAggRow_(agg, row);
    }
  }

  /** 3. CPC Performance GET（商家维度） */
  if (needMetrics()) {
    const cpcRows = await tryFetchRwCpcPerformanceGetOrders_(
      apiToken,
      startDate,
      endDate,
      onProgress,
      merchantsByDate,
    );
    for (const row of cpcRows) {
      if (mids.length > 0 && !mids.includes(row.merchantId)) continue;
      mergeRwAggRow_(agg, row);
    }
  }

  /** 4. 按商家 mid 过滤拉取 cpc_performance / medium/performance */
  if (needMetrics()) {
    const targets = mids.length > 0 ? mids : [undefined as string | undefined];
    for (const mid of targets) {
      const rangeAgg = new Map<string, RwMerchantClickAgg>();
      for (const spec of RW_PERFORMANCE_ORDER_SOURCES) {
        const extraMid = mid ? rwMidParams_(mid) : {};
        const specWithMid: RwClickSourceSpec = {
          ...spec,
          dateParams: (b, e) => ({ ...spec.dateParams(b, e), ...extraMid }),
        };
        await fetchClickSource_(
          specWithMid,
          apiToken,
          startDate,
          endDate,
          rangeAgg,
          startDate,
          endDate,
          undefined,
          { rwPerformanceDaily: true, forcedMid: mid },
        );
      }
      for (const row of rangeAgg.values()) {
        if (row.performanceOrders <= 0 && row.clicks <= 0) continue;
        mergeRwAggRow_(agg, row);
      }
    }
  }

  /** 5. medium/performance 区间 / 逐日（performanceOrdersOnly，较慢，仅 orders 缺失时） */
  if (needOrders()) {
    for (const batch of [
      tryFetchRwMediumPerformanceOrders_,
      tryFetchRwMediumPerformanceOrdersPerDay_,
    ]) {
      const orderRows = await batch(
        apiToken,
        startDate,
        endDate,
        onProgress,
        merchantsByDate,
      );
      for (const row of orderRows) {
        if (mids.length > 0 && !mids.includes(row.merchantId)) continue;
        mergeRwAggRow_(agg, row);
      }
      if (sumAggPerformanceOrders_(agg) > 0) break;
    }
  }

  /** 6. 账号级 Group by Daily → 按日单商家归因 */
  if (needMetrics() && merchantsByDate.size > 0) {
    const accountDaily = await fetchAccountDailyPerformanceMetrics_(
      apiToken,
      startDate,
      endDate,
      onProgress,
    );
    const attributed = attributeAccountDailyPerformanceMetrics_(
      accountDaily,
      merchantsByDate,
    );
    for (const row of attributed) mergeRwAggRow_(agg, row);
  }

  /** 7. 点击兜底（仅勾选「含联盟点击」时） */
  if (needClicks()) {
    try {
      const clickRows = await fetchRewardooClicks(apiToken, startDate, endDate);
      const clickTotal = clickRows.reduce((s, r) => s + r.clicks, 0);
      if (clickTotal > 0) {
        await onProgress?.(`Performance 汇总点击 → ${clickTotal}`);
        for (const row of clickRows) {
          if (mids.length > 0 && !mids.includes(row.merchantId)) continue;
          if (isRwClickPseudoMerchant(row.merchantId)) continue;
          mergeRwAggRow_(agg, {
            ...row,
            performanceOrders: 0,
            performanceCommission: 0,
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await onProgress?.(`Performance 点击汇总跳过: ${msg.slice(0, 60)}`);
    }
  }

  if (needClicks()) {
    const clickAgg = new Map<string, RwMerchantClickAgg>();
    const gotClicks = await fetchRwUserClickAggs_(apiToken, startDate, endDate, clickAgg);
    if (gotClicks) {
      const clickTotal = sumAggClicks_(clickAgg);
      await onProgress?.(`user_click 补充 → ${clickTotal} 点击`);
      for (const row of clickAgg.values()) {
        if (isRwClickPseudoMerchant(row.merchantId)) continue;
        if (mids.length > 0 && !mids.includes(row.merchantId)) continue;
        mergeRwAggRow_(agg, {
          ...row,
          performanceOrders: 0,
          performanceCommission: 0,
        });
      }
    }
  }

  const orderTotal = sumAggPerformanceOrders_(agg);
  const clickTotal = sumAggClicks_(agg);
  if (orderTotal > 0 || clickTotal > 0) {
    await onProgress?.(
      `Performance 按日汇总 → ${orderTotal} 单 / ${clickTotal} 点击（${agg.size} 条商家日）`,
    );
  } else {
    await onProgress?.('Performance 按日 API 全部为空（orders/clicks 均未解析）');
  }

  return [...agg.values()];
}

/** CPS 按天 Performance（与 fetchRewardooClicks 同源链路） */
const RW_CPS_DAILY_SOURCES: RwClickSourceSpec[] = [
  {
    label: 'medium/performance CPS',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e, offer_type: 'CPS' }),
  },
  {
    label: 'medium/performance',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e }),
  },
  {
    label: 'CommissionSummary API',
    mod: 'commission',
    op: 'summary',
    dateParams: (b, e) => ({ begin_date: b, end_date: e }),
  },
  {
    label: 'medium/cpc_performance daily',
    mod: 'medium',
    op: 'cpc_performance',
    dateParams: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
    }),
  },
];

/**
 * 合并 Performance 汇总与点击采集结果（按 merchantId|clickDate）
 */
export function mergeRwPerformanceWithClickAggs(
  perfAggs: RwMerchantClickAgg[],
  clickAggs: RwMerchantClickAgg[],
): RwMerchantClickAgg[] {
  const map = new Map<string, RwMerchantClickAgg>();
  for (const a of perfAggs) {
    map.set(`${a.merchantId}|${a.clickDate}`, { ...a });
  }
  for (const c of clickAggs) {
    const key = `${c.merchantId}|${c.clickDate}`;
    const existing = map.get(key);
    if (existing) {
      existing.clicks = Math.max(existing.clicks, c.clicks);
      existing.performanceOrders = Math.max(existing.performanceOrders, c.performanceOrders);
      existing.performanceCommission = Math.max(
        existing.performanceCommission,
        c.performanceCommission,
      );
      if (!existing.merchantName && c.merchantName) existing.merchantName = c.merchantName;
    } else {
      map.set(key, { ...c });
    }
  }
  return [...map.values()];
}

/**
 * 合并明细与 Performance 按日 API：佣金保留 transaction_details；仅补充 orders/clicks
 */
export function mergeRwPerformancePreferApiDaily(
  detailAggs: RwMerchantClickAgg[],
  apiAggs: RwMerchantClickAgg[],
): RwMerchantClickAgg[] {
  const map = new Map<string, RwMerchantClickAgg>();
  for (const a of detailAggs) {
    map.set(`${a.merchantId}|${a.clickDate}`, { ...a });
  }
  for (const c of apiAggs) {
    if (c.performanceOrders <= 0 && c.clicks <= 0) continue;

    const key = `${c.merchantId}|${c.clickDate}`;
    const existing = map.get(key);
    const detailComm = existing?.performanceCommission ?? 0;

    map.set(key, {
      merchantId: c.merchantId,
      merchantName: c.merchantName || existing?.merchantName || '',
      clickDate: c.clickDate,
      clicks: c.clicks > 0 ? c.clicks : (existing?.clicks ?? 0),
      performanceOrders:
        c.performanceOrders > 0 ? c.performanceOrders : (existing?.performanceOrders ?? 0),
      performanceCommission:
        detailComm > 0
          ? detailComm
          : c.performanceCommission > 0
            ? c.performanceCommission
            : 0,
    });
  }
  return [...map.values()];
}

/** 将 transaction_details 日汇总转为 RwMerchantClickAgg */
export function rwDetailMetricsToClickAggs(
  details: Array<{
    merchantId: string;
    merchantName: string;
    clickDate: string;
    performanceOrders: number;
    performanceCommission: number;
    clicks: number;
  }>,
): RwMerchantClickAgg[] {
  return details.map((d) => ({ ...d }));
}

async function fetchRwPerformanceDaily_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  merchantsByDate?: Map<string, Set<string>>,
): Promise<RwMerchantClickAgg[]> {
  const merchantIds = new Set<string>();
  for (const mids of merchantsByDate?.values() ?? []) {
    for (const mid of mids) merchantIds.add(mid);
  }

  const dayAgg = new Map<string, RwMerchantClickAgg>();
  const midsToTry =
    merchantIds.size > 0 ? [...merchantIds] : [undefined as string | undefined];
  const dates = listInclusiveDates_(startDate, endDate);
  let lastSource = '';

  const trySources = async (
    rangeBegin: string,
    rangeEnd: string,
    mid?: string,
    defaultDate?: string,
  ): Promise<boolean> => {
    for (const spec of RW_CPS_DAILY_SOURCES) {
      const ordersBefore = sumAggPerformanceOrders_(dayAgg);
      const clicksBefore = sumAggClicks_(dayAgg);
      const extraMid = mid ? rwMidParams_(mid) : {};
      const specWithMid: RwClickSourceSpec = {
        ...spec,
        dateParams: (b, e) => ({ ...spec.dateParams(b, e), ...extraMid }),
      };
      if (
        await fetchClickSource_(
          specWithMid,
          apiToken,
          rangeBegin,
          rangeEnd,
          dayAgg,
          startDate,
          endDate,
          defaultDate,
          { rwPerformanceDaily: true, forcedMid: mid },
        )
      ) {
        if (
          sumAggPerformanceOrders_(dayAgg) > ordersBefore ||
          sumAggClicks_(dayAgg) > clicksBefore
        ) {
          lastSource = spec.label;
          return true;
        }
      }
    }
    return false;
  };

  for (const dateStr of dates) {
    for (const mid of midsToTry) {
      const mapKey = mid ? `${mid}|${dateStr}` : '';
      if (mid && dayAgg.has(mapKey)) {
        const row = dayAgg.get(mapKey)!;
        if (row.performanceOrders > 0 || row.performanceCommission > 0 || row.clicks > 0) {
          continue;
        }
      }
      await trySources(dateStr, dateStr, mid, dateStr);
    }
  }

  if (!hasAggMetrics_(dayAgg)) {
    for (const mid of midsToTry) {
      await trySources(startDate, endDate, mid);
    }
  }

  if (!hasAggMetrics_(dayAgg)) {
    await onProgress?.('CPS Performance API 无数据（medium/performance CPS / CommissionSummary）');
    return [];
  }

  const totalOrders = sumAggPerformanceOrders_(dayAgg);
  const totalComm = sumAggPerformanceCommission_(dayAgg);
  const totalClicks = sumAggClicks_(dayAgg);
  await onProgress?.(
    `${lastSource || 'CPS Performance'} → ${totalOrders} 单 / $${totalComm.toFixed(2)} / 点击 ${totalClicks}（${dayAgg.size} 条商家日）`,
  );
  return [...dayAgg.values()];
}

/** 解析 RW Performance 汇总行 Comm.（与后台 Performance Daily 一致） */
function extractRwPerformanceCommissionFromRow_(
  row: Record<string, unknown>,
  depth = 0,
): number {
  if (depth > 4) return 0;

  for (const key of [
    'comm',
    'commission',
    'sale_comm',
    'total_comm',
    'approved_comm',
    'cps_comm',
    'cashback',
    'total_commission',
  ] as const) {
    const n = parseRwMoney_(row[key]);
    if (n > 0) return n;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const n = extractRwPerformanceCommissionFromRow_(nested as Record<string, unknown>, depth + 1);
    if (n > 0) return n;
  }

  return 0;
}

function parseRwMoney_(v: unknown): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** 合并单日 medium/performance 汇总行（statDate = Transaction Date） */
function mergeRwPerformanceDailyRow_(
  row: Record<string, unknown>,
  agg: Map<string, RwMerchantClickAgg>,
  statDate: string,
  forcedMid?: string,
): void {
  const merchantId = resolveRwClickMerchantId_(row) || forcedMid || '';
  if (!merchantId) return;

  const orders = extractRwPerformanceOrdersFromRow_(row);
  const clicks = extractRwClickCountFromRow_(row);
  const commission = extractRwPerformanceCommissionFromRow_(row);
  if (orders === 0 && clicks === 0 && commission === 0) return;

  const key = `${merchantId}|${statDate}`;
  const existing = agg.get(key);
  const merchantName = String(row.merchant_name ?? row.advertiser_name ?? '');
  if (!existing) {
    agg.set(key, {
      merchantId,
      merchantName,
      clickDate: statDate,
      clicks,
      performanceOrders: orders,
      performanceCommission: commission,
    });
    return;
  }

  if (!existing.merchantName && merchantName) existing.merchantName = merchantName;
  existing.performanceOrders = Math.max(existing.performanceOrders, orders);
  existing.performanceCommission = Math.max(existing.performanceCommission, commission);
  existing.clicks = Math.max(existing.clicks, clicks);
}

function rwMidParams_(mid: string): Record<string, string> {
  return { mid, m_id: mid, merchant_id: mid };
}

/**
 * 按自然日逐日拉取 medium/performance（与 RW 后台 Group by Daily 一致，最可靠）
 */
async function tryFetchRwMediumPerformanceOrdersPerDay_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  merchantsByDate?: Map<string, Set<string>>,
): Promise<RwMerchantClickAgg[]> {
  const merchantIds = new Set<string>();
  for (const mids of merchantsByDate?.values() ?? []) {
    for (const mid of mids) merchantIds.add(mid);
  }

  const dates = listInclusiveDates_(startDate, endDate);
  const dayAgg = new Map<string, RwMerchantClickAgg>();
  const midsToTry =
    merchantIds.size > 0 ? [...merchantIds] : [undefined as string | undefined];

  for (const dateStr of dates) {
    for (const mid of midsToTry) {
      const paramVariants: Record<string, string>[] = [
        {
          begin_date: dateStr,
          end_date: dateStr,
          ...(mid ? rwMidParams_(mid) : {}),
        },
        {
          begin_date: dateStr,
          end_date: dateStr,
          offer_type: 'CPS',
          ...(mid ? rwMidParams_(mid) : {}),
        },
      ];

      for (const params of paramVariants) {
        await forEachRewardooGetPage_('medium', 'performance', apiToken, params, (rows) => {
          for (const raw of rows) {
            mergeSummaryClickRow_(
              raw as Record<string, unknown>,
              dayAgg,
              dateStr,
              dateStr,
              dateStr,
              { performanceOrdersOnly: true },
            );
          }
        });
      }
    }
  }

  if (sumAggPerformanceOrders_(dayAgg) > 0) {
    const total = sumAggPerformanceOrders_(dayAgg);
    await onProgress?.(
      `medium/performance 逐日 → ${total} 单（${dayAgg.size} 条商家日）`,
    );
    return [...dayAgg.values()];
  }

  return [];
}

/** CPS Performance：medium/performance + mid（区间兜底，逐日失败时使用） */
async function tryFetchRwMediumPerformanceOrders_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  merchantsByDate?: Map<string, Set<string>>,
): Promise<RwMerchantClickAgg[]> {
  const merchantIds = new Set<string>();
  for (const mids of merchantsByDate?.values() ?? []) {
    for (const mid of mids) merchantIds.add(mid);
  }

  const midTargets: Array<string | undefined> =
    merchantIds.size > 0 ? [...merchantIds] : [undefined];
  if (merchantIds.size > 1) {
    midTargets.push(undefined);
  }

  for (const mid of midTargets) {
    const label = mid ? `mid=${mid}` : '全账号';
    const accountDaily = new Map<string, number>();
    const paramVariants: Record<string, string>[] = [
      {
        begin_date: startDate,
        end_date: endDate,
        ...(mid ? rwMidParams_(mid) : {}),
      },
      {
        begin_date: startDate,
        end_date: endDate,
        offer_type: 'CPS',
        ...(mid ? rwMidParams_(mid) : {}),
      },
    ];

    for (const baseParams of paramVariants) {
      const variantLabel =
        baseParams.offer_type === 'CPS' ? `${label} CPS` : label;
      const merchantAgg = new Map<string, RwMerchantClickAgg>();
      const mergeRows = (rows: unknown[]) => {
        for (const raw of rows) {
          mergeSummaryClickRow_(
            raw as Record<string, unknown>,
            merchantAgg,
            startDate,
            endDate,
            undefined,
            { performanceOrdersOnly: true, accountDailyOrders: accountDaily },
          );
        }
      };

      const getResult = await forEachRewardooGetPage_(
        'medium',
        'performance',
        apiToken,
        baseParams,
        mergeRows,
      );
      if (sumAggPerformanceOrders_(merchantAgg) > 0) {
        const total = sumAggPerformanceOrders_(merchantAgg);
        await onProgress?.(
          `medium/performance GET ${variantLabel} → ${total} 单（${getResult.rowCount} 行）`,
        );
        return [...merchantAgg.values()];
      }

      try {
        await forEachRewardooPageLimit(
          'medium',
          'performance',
          apiToken,
          baseParams,
          mergeRows,
          RW_CLICK_PAGE_SIZE,
        );
      } catch {
        /* 尝试 offset */
      }

      if (sumAggPerformanceOrders_(merchantAgg) > 0) {
        const total = sumAggPerformanceOrders_(merchantAgg);
        await onProgress?.(`medium/performance POST ${variantLabel} → ${total} 单`);
        return [...merchantAgg.values()];
      }
    }

    const merchantAgg = new Map<string, RwMerchantClickAgg>();
    const mergeRows = (rows: unknown[]) => {
      for (const raw of rows) {
        mergeSummaryClickRow_(
          raw as Record<string, unknown>,
          merchantAgg,
          startDate,
          endDate,
          undefined,
          { performanceOrdersOnly: true, accountDailyOrders: accountDaily },
        );
      }
    };

    try {
      await forEachRewardooPageLimit(
        'commission',
        'performance',
        apiToken,
        {
          begin_date: startDate,
          end_date: endDate,
          payment_begin: startDate,
          payment_end: endDate,
          ...(mid ? rwMidParams_(mid) : {}),
        },
        mergeRows,
        RW_CLICK_PAGE_SIZE,
      );
      if (sumAggPerformanceOrders_(merchantAgg) > 0) {
        const total = sumAggPerformanceOrders_(merchantAgg);
        await onProgress?.(`commission/performance ${label} → ${total} 单`);
        return [...merchantAgg.values()];
      }
    } catch {
      /* ignore */
    }

    const accountTotal = sumMapValues_(accountDaily);
    if (accountTotal > 0) {
      const attributed = attributeAccountDailyPerformanceOrders_(accountDaily, merchantsByDate);
      if (attributed.length > 0) {
        await onProgress?.(`medium/performance ${label} 账号按日 → ${accountTotal} 单`);
        return attributed;
      }
    }
  }

  const dates = listInclusiveDates_(startDate, endDate);
  const dayAgg = new Map<string, RwMerchantClickAgg>();
  const midsToTry =
    merchantIds.size > 0 ? [...merchantIds] : [undefined as string | undefined];

  for (const dateStr of dates) {
    for (const mid of midsToTry) {
      const params: Record<string, string> = {
        begin_date: dateStr,
        end_date: dateStr,
        ...(mid ? rwMidParams_(mid) : {}),
      };
      await forEachRewardooGetPage_('medium', 'performance', apiToken, params, (rows) => {
        for (const raw of rows) {
          mergeSummaryClickRow_(
            raw as Record<string, unknown>,
            dayAgg,
            dateStr,
            dateStr,
            dateStr,
            { performanceOrdersOnly: true },
          );
        }
      });
    }
  }

  if (sumAggPerformanceOrders_(dayAgg) > 0) {
    const total = sumAggPerformanceOrders_(dayAgg);
    await onProgress?.(`medium/performance 逐日汇总 → ${total} 单（${dayAgg.size} 条）`);
    return [...dayAgg.values()];
  }

  return [];
}

/** RW 文档 CPC Performance API（GET 分页，优先于 POST） */
async function tryFetchRwCpcPerformanceGetOrders_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  merchantsByDate?: Map<string, Set<string>>,
): Promise<RwMerchantClickAgg[]> {
  for (const variant of RW_CPC_PERFORMANCE_GET_VARIANTS) {
    const merchantAgg = new Map<string, RwMerchantClickAgg>();
    const accountDaily = new Map<string, number>();
    const extraParams = variant.params(startDate, endDate);

    const { rowCount, code } = await forEachRewardooGetPage_(
      'medium',
      'cpc_performance',
      apiToken,
      extraParams,
      (rows) => {
        for (const raw of rows) {
          mergeSummaryClickRow_(
            raw as Record<string, unknown>,
            merchantAgg,
            startDate,
            endDate,
            undefined,
            { performanceOrdersOnly: true, accountDailyOrders: accountDaily },
          );
        }
      },
    );

    const merchantTotal = sumAggPerformanceOrders_(merchantAgg);
    const accountTotal = sumMapValues_(accountDaily);
    if (merchantTotal > 0) {
      await onProgress?.(
        `CPC Performance GET ${variant.label} → ${merchantTotal} 单（${merchantAgg.size} 条，${rowCount} 行）`,
      );
      return [...merchantAgg.values()];
    }
    if (accountTotal > 0) {
      const attributed = attributeAccountDailyPerformanceOrders_(accountDaily, merchantsByDate);
      if (attributed.length > 0) {
        await onProgress?.(
          `CPC Performance GET ${variant.label} 账号按日 → ${accountTotal} 单（code=${code}）`,
        );
        return attributed;
      }
    }
  }

  return [];
}

/** RW 文档 CommissionSummary API */
async function tryFetchRwCommissionSummaryOrders_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
  merchantsByDate?: Map<string, Set<string>>,
): Promise<RwMerchantClickAgg[]> {
  for (const variant of RW_COMMISSION_SUMMARY_VARIANTS) {
    const merchantAgg = new Map<string, RwMerchantClickAgg>();
    const accountDaily = new Map<string, number>();
    const extraParams = variant.params(startDate, endDate);

    try {
      const { rowCount } = await forEachRewardooPageLimit(
        'commission',
        'summary',
        apiToken,
        extraParams,
        (rows) => {
          for (const raw of rows) {
            mergeSummaryClickRow_(
              raw as Record<string, unknown>,
              merchantAgg,
              startDate,
              endDate,
              undefined,
              { performanceOrdersOnly: true, accountDailyOrders: accountDaily },
            );
          }
        },
        RW_CLICK_PAGE_SIZE,
      );

      const merchantTotal = sumAggPerformanceOrders_(merchantAgg);
      const accountTotal = sumMapValues_(accountDaily);
      if (merchantTotal > 0) {
        await onProgress?.(
          `CommissionSummary ${variant.label} → ${merchantTotal} 单（${rowCount} 行）`,
        );
        return [...merchantAgg.values()];
      }
      if (accountTotal > 0) {
        const attributed = attributeAccountDailyPerformanceOrders_(accountDaily, merchantsByDate);
        if (attributed.length > 0) {
          await onProgress?.(`CommissionSummary ${variant.label} 账号按日 → ${accountTotal} 单`);
          return attributed;
        }
      }
    } catch {
      continue;
    }
  }

  return [];
}

/** GET 分页（CPC Performance API 官方用法） */
async function forEachRewardooGetPage_(
  mod: string,
  op: string,
  apiToken: string,
  extraParams: Record<string, string>,
  onPage: (rows: unknown[]) => void | Promise<void>,
  pageSize = RW_CLICK_PAGE_SIZE,
): Promise<{ rowCount: number; code: number; message: string }> {
  let page = 1;
  let totalPages = 1;
  let rowCount = 0;
  let lastCode = -1;
  let lastMessage = '';

  for (; page <= totalPages && page <= 500; page += 1) {
    await throttleRwClickRequest_();
    const { data } = await axios.get<unknown>(RW_API_BASE, {
      params: {
        mod,
        op,
        token: apiToken,
        type: 'json',
        page: String(page),
        limit: String(pageSize),
        ...extraParams,
      },
      timeout: 120000,
      validateStatus: () => true,
    });
    const parsed = parseRwApiEnvelope(data);
    lastCode = parsed.code;
    lastMessage = parsed.message;

    if (parsed.code === 1002) {
      await sleepRwClick_(65000);
      page -= 1;
      continue;
    }
    if (parsed.code === 1003 || parsed.code === 1004) {
      return { rowCount: 0, code: parsed.code, message: lastMessage };
    }
    if (parsed.code !== 0) {
      return { rowCount, code: parsed.code, message: lastMessage };
    }

    if (parsed.rows.length) {
      await onPage(parsed.rows);
      rowCount += parsed.rows.length;
    }

    totalPages = parsed.totalPages ?? 1;
    if (parsed.rows.length < pageSize) break;
  }

  return { rowCount, code: lastCode, message: lastMessage };
}

function sleepRwClick_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 拉取账号级 Performance Daily（与 RW 后台 Group by Daily 一致） */
async function fetchAccountDailyPerformanceOrders_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<Map<string, number>> {
  const accountDaily = new Map<string, number>();

  for (const spec of RW_ACCOUNT_DAILY_PERFORMANCE_SOURCES) {
    const before = sumMapValues_(accountDaily);
    await fetchClickSource_(
      spec,
      apiToken,
      startDate,
      endDate,
      new Map(),
      startDate,
      endDate,
      undefined,
      {
        requireOrders: true,
        accountDailyOrders: accountDaily,
      },
    );
    if (sumMapValues_(accountDaily) > before) {
      await onProgress?.(
        `Performance ${spec.label} 账号按日 → ${sumMapValues_(accountDaily)} 单`,
      );
      return accountDaily;
    }
  }

  return accountDaily;
}

/** 账号级按日 Orders 归因到商家（单商家直接映射，多商家按日唯一匹配） */
function attributeAccountDailyPerformanceOrders_(
  accountDaily: Map<string, number>,
  merchantsByDate?: Map<string, Set<string>>,
): RwMerchantClickAgg[] {
  if (!merchantsByDate || merchantsByDate.size === 0) return [];

  const allMerchants = new Set<string>();
  for (const mids of merchantsByDate.values()) {
    for (const mid of mids) allMerchants.add(mid);
  }

  const out: RwMerchantClickAgg[] = [];

  if (allMerchants.size === 1) {
    const merchantId = [...allMerchants][0]!;
    for (const [clickDate, performanceOrders] of accountDaily) {
      if (performanceOrders <= 0) continue;
      out.push({
        merchantId,
        merchantName: '',
        clickDate,
        clicks: 0,
        performanceOrders,
        performanceCommission: 0,
      });
    }
    return out;
  }

  for (const [clickDate, performanceOrders] of accountDaily) {
    if (performanceOrders <= 0) continue;
    const mids = merchantsByDate.get(clickDate);
    if (!mids || mids.size !== 1) continue;
    const merchantId = [...mids][0]!;
    out.push({
      merchantId,
      merchantName: '',
      clickDate,
      clicks: 0,
      performanceOrders,
      performanceCommission: 0,
    });
  }

  return out;
}

function sumMapValues_(map: Map<string, number>): number {
  let total = 0;
  for (const v of map.values()) total += v;
  return total;
}

/**
 * 从已入库订单构建「按日有佣金的 merchantId」索引，供 Performance 账号级归因。
 */
export function buildRwMerchantsByDateFromOrders(
  orders: Array<{ merchantId: string | null; orderDate: Date; commission: number }>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const o of orders) {
    const mid = o.merchantId?.trim();
    if (!mid || Number(o.commission) <= 0) continue;
    const dateStr = o.orderDate.toISOString().slice(0, 10);
    if (!map.has(dateStr)) map.set(dateStr, new Set());
    map.get(dateStr)!.add(mid);
  }
  return map;
}

/** 尝试各汇总数据源：先整段，再按日；每种先试 page/limit，再试 offset */
async function trySummarizedClickSources_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < RW_CLICK_SUMMARY_SOURCES.length; i += 1) {
    const spec = RW_CLICK_SUMMARY_SOURCES[i];
    if (
      await fetchClickSource_(spec, apiToken, startDate, endDate, agg, startDate, endDate)
    ) {
      if (onProgress) {
        await onProgress({
          phase: 'summary',
          slotIndex: i + 1,
          totalSlots: RW_CLICK_SUMMARY_SOURCES.length,
          clicksSoFar: sumAggClicks_(agg),
          source: spec.label,
        });
      }
      return true;
    }
  }

  const dates = listInclusiveDates_(startDate, endDate);
  for (const dateStr of dates) {
    for (const spec of RW_CLICK_SUMMARY_SOURCES) {
      if (
        await fetchClickSource_(
          spec,
          apiToken,
          dateStr,
          dateStr,
          agg,
          startDate,
          endDate,
          dateStr,
        )
      ) {
        break;
      }
    }
  }

  return agg.size > 0;
}

async function fetchClickSource_(
  spec: RwClickSourceSpec,
  apiToken: string,
  rangeBegin: string,
  rangeEnd: string,
  agg: Map<string, RwMerchantClickAgg>,
  filterStart: string,
  filterEnd: string,
  defaultDate?: string,
  options?: {
    performanceOrdersOnly?: boolean;
    /** @deprecated 使用 performanceOrdersOnly */
    requireOrders?: boolean;
    accountDailyOrders?: Map<string, number>;
    accountDailyMetrics?: Map<string, RwAccountDailyMetrics>;
    rwPerformanceDaily?: boolean;
    forcedMid?: string;
  },
): Promise<boolean> {
  const performanceOrdersOnly =
    options?.performanceOrdersOnly || options?.requireOrders || false;
  const extraParams = { ...(spec.extra ?? {}), ...spec.dateParams(rangeBegin, rangeEnd) };
  const ordersBefore = sumAggPerformanceOrders_(agg);
  const clicksBefore = sumAggClicks_(agg);
  const accountOrdersBefore = options?.accountDailyOrders
    ? sumMapValues_(options.accountDailyOrders)
    : 0;
  const accountMetricsOrdersBefore = options?.accountDailyMetrics
    ? sumAccountDailyOrders_(options.accountDailyMetrics)
    : 0;
  const accountMetricsClicksBefore = options?.accountDailyMetrics
    ? sumAccountDailyClicks_(options.accountDailyMetrics)
    : 0;

  const merge = (rows: unknown[]) => {
    for (const raw of rows) {
      mergeSummaryClickRow_(
        raw as Record<string, unknown>,
        agg,
        filterStart,
        filterEnd,
        defaultDate,
        {
          ...options,
          performanceOrdersOnly,
        },
      );
    }
  };

  const isSuccess = () => {
    if (
      options?.accountDailyMetrics &&
      (sumAccountDailyOrders_(options.accountDailyMetrics) > accountMetricsOrdersBefore ||
        sumAccountDailyClicks_(options.accountDailyMetrics) > accountMetricsClicksBefore)
    ) {
      return true;
    }
    if (options?.accountDailyOrders && sumMapValues_(options.accountDailyOrders) > accountOrdersBefore) {
      return true;
    }
    if (options?.rwPerformanceDaily) {
      return (
        sumAggPerformanceOrders_(agg) > ordersBefore ||
        sumAggClicks_(agg) > clicksBefore
      );
    }
    return performanceOrdersOnly
      ? sumAggPerformanceOrders_(agg) > ordersBefore
      : hasAggMetrics_(agg);
  };

  try {
    if (spec.op === 'cpc_performance') {
      const getParams = { ...(spec.extra ?? {}), ...spec.dateParams(rangeBegin, rangeEnd) };
      const getResult = await forEachRewardooGetPage_(
        spec.mod,
        spec.op,
        apiToken,
        getParams,
        merge,
      );
      if (getResult.rowCount > 0 && isSuccess()) return true;
    }

    const pageResult = await forEachRewardooPageLimit(
      spec.mod,
      spec.op,
      apiToken,
      extraParams,
      merge,
      RW_CLICK_PAGE_SIZE,
    );
    if (!pageResult.skipped && isSuccess()) return true;

    if (pageResult.rowCount === 0 || !isSuccess()) {
      const offsetResult = await forEachRewardooOffsetPage(
        spec.mod,
        spec.op,
        apiToken,
        extraParams,
        merge,
        RW_CLICK_PAGE_SIZE,
      );
      if (!offsetResult.skipped && isSuccess()) return true;
    }

    if (spec.mod === 'medium' && !isSuccess()) {
      if (await fetchMediumPerformanceViaGet_(spec, apiToken, extraParams, merge)) {
        return isSuccess();
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * LinkBux 系 user_click：按自然日 GET，单日 total_items 与后台 CPS Total Clicks 一致。
 */
async function fetchRwUserClickAggs_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  const dates = listInclusiveDates_(startDate, endDate);
  let hadAnyResponse = false;

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const day = dates[dayIndex];
    const dayResult = await fetchRwUserClickDay_(apiToken, day);
    if (dayResult.skipped) continue;
    hadAnyResponse = true;

    const seenRefs = new Set<string>();
    for (const raw of dayResult.rows) {
      const row = raw as RwClickRow;
      const merchantId = resolveRwClickMerchantId_(row);
      if (!merchantId) continue;

      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
      }

      const aggKey = `${merchantId}|${day}`;
      const existing = agg.get(aggKey);
      if (existing) {
        existing.clicks += 1;
      } else {
        agg.set(aggKey, {
          merchantId,
          merchantName: String(row.merchant_name ?? ''),
          clickDate: day,
          clicks: 1,
          performanceOrders: 0,
          performanceCommission: 0,
        });
      }
    }

    /** 首页样本不足时，用 total_items 补全当日未分配点击（与 LB 一致） */
    if (dayResult.totalItems > sumAggClicksForDay_(agg, day)) {
      allocateRwDayClickGap_(agg, day, dayResult.totalItems);
    }

    if (onProgress && (dayIndex === 0 || dayIndex === dates.length - 1)) {
      await onProgress({
        phase: 'user_click',
        slotIndex: dayIndex + 1,
        totalSlots: dates.length,
        clicksSoFar: sumAggClicks_(agg),
        source: 'medium/user_click',
      });
    }
  }

  return hadAnyResponse && sumAggClicks_(agg) > 0;
}

async function fetchRwUserClickDay_(
  apiToken: string,
  day: string,
): Promise<{
  skipped: boolean;
  rows: unknown[];
  totalItems: number;
}> {
  await throttleRwClickRequest_();

  try {
    const { data } = await axios.get<unknown>(RW_API_BASE, {
      params: {
        mod: 'medium',
        op: 'user_click',
        token: apiToken,
        begin_date: day,
        end_date: day,
        type: 'json',
        page: '1',
        limit: String(RW_CLICK_PAGE_SIZE),
      },
      timeout: 120000,
      validateStatus: () => true,
    });

    const parsed = parseRwApiEnvelope(data);
    if (parsed.code === 1003 || parsed.code === 1004) {
      return { skipped: true, rows: [], totalItems: 0 };
    }
    if (parsed.code !== 0) {
      return { skipped: true, rows: [], totalItems: 0 };
    }

    const totalItems = extractRwTotalItems_(data, parsed.rows.length);
    return {
      skipped: false,
      rows: parsed.rows,
      totalItems: totalItems > 0 ? totalItems : parsed.rows.length,
    };
  } catch {
    return { skipped: true, rows: [], totalItems: 0 };
  }
}

function extractRwTotalItems_(body: unknown, listLen: number): number {
  const root = body as Record<string, unknown>;
  const payload = (root.payliad ?? root.payload ?? root.data ?? root) as Record<string, unknown>;
  const total = (payload.total ?? payload) as Record<string, unknown>;
  const n = Number(
    total.total_items ?? payload.total_items ?? root.total_items ?? 0,
  );
  return Number.isFinite(n) && n > 0 ? n : listLen;
}

function sumAggClicksForDay_(agg: Map<string, RwMerchantClickAgg>, day: string): number {
  let total = 0;
  for (const row of agg.values()) {
    if (row.clickDate === day) total += row.clicks;
  }
  return total;
}

/** 当日 user_click 首页样本不足 total_items 时，将缺口计入未解析商家桶 */
function allocateRwDayClickGap_(
  agg: Map<string, RwMerchantClickAgg>,
  day: string,
  totalItems: number,
): void {
  const sampleTotal = sumAggClicksForDay_(agg, day);
  if (totalItems <= sampleTotal) return;

  const gap = totalItems - sampleTotal;
  const key = `__rw_unmatched__|${day}`;
  const existing = agg.get(key);
  if (existing) {
    existing.clicks += gap;
  } else {
    agg.set(key, {
      merchantId: '__rw_unmatched__',
      merchantName: '未解析商家',
      clickDate: day,
      clicks: gap,
      performanceOrders: 0,
      performanceCommission: 0,
    });
  }
}

/** LinkBux 系 performance 部分站点仅支持 GET + query（与 POST 等价参数） */
async function fetchMediumPerformanceViaGet_(
  spec: RwClickSourceSpec,
  apiToken: string,
  extraParams: Record<string, string>,
  merge: (rows: unknown[]) => void,
): Promise<boolean> {
  try {
    const { rowCount, code } = await forEachRewardooGetPage_(
      spec.mod,
      spec.op,
      apiToken,
      extraParams,
      (rows) => merge(rows),
    );
    return rowCount > 0 && code === 0;
  } catch {
    return false;
  }
}

/** 汇总行：clicks / orders 字段为当日次数（非逐条明细） */
function mergeSummaryClickRow_(
  row: Record<string, unknown>,
  agg: Map<string, RwMerchantClickAgg>,
  startDate: string,
  endDate: string,
  defaultDate?: string,
  options?: {
    performanceOrdersOnly?: boolean;
    accountDailyOrders?: Map<string, number>;
    /** 账号级按日 orders + clicks（Group by Daily 汇总行） */
    accountDailyMetrics?: Map<string, RwAccountDailyMetrics>;
    rwPerformanceDaily?: boolean;
    forcedMid?: string;
  },
): void {
  if (options?.rwPerformanceDaily) {
    const merchantId = resolveRwClickMerchantId_(row) || options.forcedMid || '';
    if (!merchantId) return;

    const orders = extractRwPerformanceOrdersFromRow_(row);
    const clicks = extractRwClickCountFromRow_(row);
    const commission = extractRwPerformanceCommissionFromRow_(row);
    if (orders === 0 && clicks === 0 && commission === 0) return;

    const clickDate = parseRwRowDate_(row) || defaultDate || '';
    if (!clickDate || clickDate < startDate || clickDate > endDate) return;

    const key = `${merchantId}|${clickDate}`;
    const existing = agg.get(key);
    const merchantName = String(row.merchant_name ?? row.advertiser_name ?? '');
    if (existing) {
      existing.clicks = Math.max(existing.clicks, clicks);
      existing.performanceOrders = Math.max(existing.performanceOrders, orders);
      existing.performanceCommission = Math.max(existing.performanceCommission, commission);
      if (!existing.merchantName && merchantName) existing.merchantName = merchantName;
    } else {
      agg.set(key, {
        merchantId,
        merchantName,
        clickDate,
        clicks,
        performanceOrders: orders,
        performanceCommission: commission,
      });
    }
    return;
  }

  if (options?.performanceOrdersOnly && isRwTransactionDetailRow_(row)) return;

  const merchantId = resolveRwClickMerchantId_(row);
  const orders = options?.performanceOrdersOnly
    ? extractRwPerformanceOrdersFromRow_(row)
    : extractRwOrderCountFromRow_(row);
  if (options?.performanceOrdersOnly && orders <= 0) return;

  if (options?.performanceOrdersOnly && !merchantId && (options.accountDailyOrders || options.accountDailyMetrics)) {
    const clickDate = parseRwRowDate_(row) || defaultDate || '';
    if (!clickDate || clickDate < startDate || clickDate > endDate) return;
    const clicks = extractRwClickCountFromRow_(row);
    if (options.accountDailyOrders) {
      options.accountDailyOrders.set(
        clickDate,
        Math.max(options.accountDailyOrders.get(clickDate) ?? 0, orders),
      );
    }
    if (options.accountDailyMetrics) {
      const prev = options.accountDailyMetrics.get(clickDate) ?? { orders: 0, clicks: 0 };
      options.accountDailyMetrics.set(clickDate, {
        orders: Math.max(prev.orders, orders),
        clicks: Math.max(prev.clicks, clicks),
      });
    }
    return;
  }

  if (!merchantId) return;

  const clicks = extractRwClickCountFromRow_(row);
  if (clicks <= 0 && orders <= 0) return;

  const clickDate = parseRwRowDate_(row) || defaultDate || '';
  if (!clickDate || clickDate < startDate || clickDate > endDate) return;

  const key = `${merchantId}|${clickDate}`;
  const existing = agg.get(key);
  if (existing) {
    existing.clicks += clicks;
    if (orders > 0) {
      if (options?.performanceOrdersOnly && orders >= 2) {
        existing.performanceOrders = orders;
      } else {
        existing.performanceOrders = Math.max(existing.performanceOrders, orders);
      }
    }
  } else {
    agg.set(key, {
      merchantId,
      merchantName: String(row.merchant_name ?? row.advertiser_name ?? ''),
      clickDate,
      clicks,
      performanceOrders: orders,
      performanceCommission: 0,
    });
  }
}

/** Daily 汇总行 Orders 字段（含部分接口返回的单数 order） */
const RW_PERFORMANCE_AGG_ORDER_FIELDS = [
  'orders',
  'order_count',
  'total_orders',
  'cps_orders',
  'order_num',
  'order_nums',
  'valid_orders',
  'total_order',
  'order',
] as const;

/** Performance 汇总行中的 Orders 字段（点击采集等宽松口径） */
const RW_PERFORMANCE_ORDER_FIELDS = [
  ...RW_PERFORMANCE_AGG_ORDER_FIELDS,
  'valid_orders',
  'complete_orders',
  'cps_orders',
  'sale_orders',
] as const;

/** 读取汇总行顶层 Orders 字段（不递归，避免与明细行判断互相调用） */
function readRwAggregateOrdersField_(row: Record<string, unknown>): number {
  for (const key of RW_PERFORMANCE_AGG_ORDER_FIELDS) {
    if (key === 'order' && isRwTransactionDetailRow_(row)) continue;
    const n = parseRwClickCount_(row[key]);
    if (n > 0) return n;
  }
  return 0;
}

/** 佣金明细行（含 sign_id 且无汇总 orders），不能当 Performance Daily 汇总 */
function isRwTransactionDetailRow_(row: Record<string, unknown>): boolean {
  if (readRwAggregateOrdersField_(row) > 1) return false;

  const signId = row.sign_id;
  if (signId == null || String(signId).trim() === '' || String(signId) === '0') {
    return false;
  }
  return true;
}

/** 从 Performance Daily 汇总行解析 Orders */
function extractRwPerformanceOrdersFromRow_(
  row: Record<string, unknown>,
  depth = 0,
): number {
  if (depth > 4) return 0;

  const agg = readRwAggregateOrdersField_(row);
  if (agg > 0) return agg;

  if (!isRwTransactionDetailRow_(row)) {
    const singular = parseRwClickCount_(row.order);
    if (singular > 0) return singular;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const n = extractRwPerformanceOrdersFromRow_(nested as Record<string, unknown>, depth + 1);
    if (n > 0) return n;
  }

  return 0;
}

/** 从 Performance 汇总行解析 Orders（与 RW 后台 Performance Daily 一致） */
function extractRwOrderCountFromRow_(row: Record<string, unknown>, depth = 0): number {
  if (depth > 4) return 0;

  for (const key of RW_PERFORMANCE_ORDER_FIELDS) {
    const n = parseRwClickCount_(row[key]);
    if (n > 0) return n;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const n = extractRwOrderCountFromRow_(nested as Record<string, unknown>, depth + 1);
    if (n > 0) return n;
  }

  return 0;
}

function extractRwClickCountFromRow_(row: Record<string, unknown>, depth = 0): number {
  if (depth > 4) return 0;

  for (const key of [
    'clicks',
    'total_clicks',
    'total_click',
    'click_count',
    'cps_clicks',
    'valid_clicks',
    'total_valid_clicks',
    'cps_click',
    'click',
  ] as const) {
    const n = parseRwClickCount_(row[key]);
    if (n > 0) return n;
  }

  for (const [key, val] of Object.entries(row)) {
    if (!/click/i.test(key)) continue;
    if (/click_(time|ref|id|url|link)|clicktime|clickdate/i.test(key)) continue;
    const n = parseRwClickCount_(val);
    if (n > 0) return n;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const n = extractRwClickCountFromRow_(nested as Record<string, unknown>, depth + 1);
    if (n > 0) return n;
  }

  return 0;
}

/**
 * 官方 ClickDetails（mod=medium&op=click_details）小时片兜底（仅 ≤1 天区间）。
 */
async function fetchClickDetailsAggs_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<void> {
  const slots = buildRwClickHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const slotSeenRefs = new Set<string>();
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 100) {
      const parsed = await postRwClickDetailsPage_(
        apiToken,
        slot.begin,
        slot.end,
        page,
      );

      if (parsed.code === 1006) {
        rateRetries += 1;
        if (rateRetries > 15) {
          throw new Error('Rewardoo click_details 频率限制（1006），请稍后重试');
        }
        await sleep_(65000);
        continue;
      }

      rateRetries = 0;

      if (parsed.code !== 0) {
        throw new Error(
          `Rewardoo click_details 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
        );
      }

      totalPages = parsed.totalPages ?? 1;
      const list = parsed.rows as RwClickRow[];

      for (const row of list) {
        const merchantId = resolveRwClickMerchantId_(row);
        if (!merchantId) continue;

        const ref = String(row.click_ref ?? '').trim();
        if (ref) {
          if (slotSeenRefs.has(ref)) continue;
          slotSeenRefs.add(ref);
        }

        const clickDate =
          parseRwClickDate_(row.click_time) || slot.begin.slice(0, 10);
        if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

        const key = `${merchantId}|${clickDate}`;
        const existing = agg.get(key);
        if (existing) {
          existing.clicks += 1;
        } else {
          agg.set(key, {
            merchantId,
            merchantName: String(row.merchant_name ?? ''),
            clickDate,
            clicks: 1,
            performanceOrders: 0,
            performanceCommission: 0,
          });
        }
      }

      if (list.length < RW_CLICK_PAGE_SIZE) break;
      page += 1;
      if (page <= totalPages) await sleep_(200);
    }

    if (
      onProgress &&
      (slotIndex === 0 || slotIndex % 12 === 0 || slotIndex === slots.length - 1)
    ) {
      await onProgress({
        phase: 'click_details',
        slotIndex: slotIndex + 1,
        totalSlots: slots.length,
        clicksSoFar: sumAggClicks_(agg),
        source: 'medium/click_details',
      });
    }
  }
}

/**
 * 生成 RW click_details 小时片（UTC+8 日历日 + 整点窗口，与官方 curl 示例一致）。
 */
export function buildRwClickHourlySlots(
  startDate: string,
  endDate: string,
): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const dates = listInclusiveDates_(startDate, endDate);

  for (const ymd of dates) {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, '0');
      const begin = `${ymd} ${hh}:00:00`;
      const end =
        h < 23
          ? `${ymd} ${String(h + 1).padStart(2, '0')}:00:00`
          : `${addCalendarDays_(ymd, 1)} 00:00:00`;
      slots.push({ begin, end });
    }
  }

  return slots;
}

/** 调用 ClickDetails 单页（始终带 page/limit，与 transaction_details 一致） */
async function postRwClickDetailsPage_(
  apiToken: string,
  beginDate: string,
  endDate: string,
  page: number,
) {
  await throttleRwClickRequest_();

  const params: Record<string, string> = {
    token: apiToken,
    type: 'json',
    begin_date: beginDate,
    end_date: endDate,
    page: String(page),
    limit: String(RW_CLICK_PAGE_SIZE),
  };

  const { data } = await axios.post<unknown>(
    `${RW_API_BASE}?mod=medium&op=click_details`,
    new URLSearchParams(params).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
      maxContentLength: 16 * 1024 * 1024,
      maxBodyLength: 16 * 1024 * 1024,
    },
  );

  if (typeof data === 'string') {
    const msg = data.trim();
    if (/token error/i.test(msg)) {
      return {
        code: 1002,
        message: msg,
        rows: [] as unknown[],
        totalPages: null as number | null,
      };
    }
    return { code: -1, message: msg, rows: [] as unknown[], totalPages: null as number | null };
  }

  const parsed = parseRwApiEnvelope(data);
  return {
    code: parsed.code === 0 ? 0 : parsed.code,
    message: parsed.message,
    rows: parsed.rows,
    totalPages: parsed.totalPages,
  };
}

function resolveRwClickMerchantId_(row: RwClickRow | Record<string, unknown>): string {
  const rec = row as Record<string, unknown>;
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'norm_id', 'mcid'] as const) {
    const raw = rec[key];
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return s;
  }

  const name = rec.merchant_name ?? rec.advertiser_name;
  if (name) {
    const paren = String(name).match(/\((\d+)\)/);
    if (paren) return paren[1];
  }

  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'mcid'] as const) {
    const raw = rec[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  return '';
}

function parseRwClickDate_(clickTime: unknown): string {
  const raw = clickTime;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1_000_000_000) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function parseRwRowDate_(row: Record<string, unknown>): string {
  for (const key of [
    'transaction_date',
    'order_ymd',
    'order_date',
    'date',
    'ymd',
    'day_ymd',
    'click_date',
    'click_ymd',
    'statistic_date',
    'statistic_ymd',
    'payment_ymd',
    'stat_date',
    'stat_ymd',
    'day',
    'report_date',
    'report_ymd',
    'begin_date',
    'end_date',
  ] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    const d = parseRwPerformanceCalendarDay(v as string | number);
    if (d) return d;
  }
  return '';
}

function parseRwClickCount_(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumAggClicks_(agg: Map<string, RwMerchantClickAgg>): number {
  let total = 0;
  for (const row of agg.values()) total += row.clicks;
  return total;
}

function sumAggPerformanceOrders_(agg: Map<string, RwMerchantClickAgg>): number {
  let total = 0;
  for (const row of agg.values()) total += row.performanceOrders;
  return total;
}

function sumAggPerformanceCommission_(agg: Map<string, RwMerchantClickAgg>): number {
  let total = 0;
  for (const row of agg.values()) total += row.performanceCommission;
  return total;
}

function hasAggMetrics_(agg: Map<string, RwMerchantClickAgg>): boolean {
  return (
    sumAggClicks_(agg) > 0 ||
    sumAggPerformanceOrders_(agg) > 0 ||
    sumAggPerformanceCommission_(agg) > 0
  );
}

export function expandRwPerformanceAggsForRange(
  perfAggs: RwMerchantClickAgg[],
  startDate: string,
  endDate: string,
): Array<{
  merchantId: string;
  merchantName: string;
  statDate: string;
  orders: number;
  clicks: number;
  commission: number;
}> {
  const merchants = new Map<string, string>();
  for (const a of perfAggs) {
    merchants.set(a.merchantId, a.merchantName);
  }
  const metricsMap = new Map<
    string,
    { orders: number; clicks: number; commission: number }
  >();
  for (const a of perfAggs) {
    metricsMap.set(`${a.merchantId}|${a.clickDate}`, {
      orders: a.performanceOrders,
      clicks: a.clicks,
      commission: a.performanceCommission,
    });
  }

  const out: Array<{
    merchantId: string;
    merchantName: string;
    statDate: string;
    orders: number;
    clicks: number;
    commission: number;
  }> = [];
  for (const dateStr of listInclusiveDates_(startDate, endDate)) {
    for (const [merchantId, merchantName] of merchants) {
      const m = metricsMap.get(`${merchantId}|${dateStr}`);
      out.push({
        merchantId,
        merchantName,
        statDate: dateStr,
        orders: m?.orders ?? 0,
        clicks: m?.clicks ?? 0,
        commission: m?.commission ?? 0,
      });
    }
  }
  return out;
}

function listInclusiveDates_(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    if (cur === endDate) break;
    cur = addCalendarDays_(cur, 1);
  }
  return out;
}

function countInclusiveDays_(startDate: string, endDate: string): number {
  return listInclusiveDates_(startDate, endDate).length;
}

function addCalendarDays_(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

async function throttleRwClickRequest_() {
  const now = Date.now();
  const wait = lastRwClickRequestAt + RW_CLICK_MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep_(wait);
  }
  lastRwClickRequestAt = Date.now();
}

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
