import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import {
  addToCommissionBreakdown,
  attachCommissionBreakdownToPayload,
  emptyCommissionBreakdown,
  mergeMixedOrderStatus,
} from '../common/commission-breakdown-collector.util';
import { CommissionBreakdown } from '../common/order-commission-buckets.util';
import { parseRwPerformanceCalendarDay } from '../common/affiliate-order-date.util';
import {
  fetchRewardooCommissionData,
  RW_TRANSACTION_DETAILS_OP,
} from './rewardoo-api.util';
import { NormalizedOrder } from './types';
import { normalizeStatus } from './status-normalizer';

/** Rewardoo API 单行（订单明细或 Performance 商家汇总） */
export interface RwCommissionRow {
  order_id?: string | number;
  rewardoo_id?: string | number;
  transaction_id?: string | number;
  sign_id?: string | number;
  txn_id?: string | number;
  m_id?: string | number;
  mid?: string | number;
  mcid?: string | number;
  brand_id?: string | number;
  norm_id?: string | number;
  merchant_id?: string | number;
  merchant_name?: string;
  sitename?: string;
  advertiser_name?: string;
  sale_amount?: string | number;
  amount?: string | number;
  order_amount?: string | number;
  sale?: string | number;
  sale_comm?: string | number;
  commission?: string | number;
  comm?: string | number;
  cashback?: string | number;
  status?: string | number;
  order_time?: string | number;
  transaction_time?: string | number;
  order_ymd?: string;
  transaction_date?: string;
  order_date?: string;
  validation_date?: string;
  payment_ymd?: string;
  date?: string;
  ymd?: string;
  orders?: string | number;
  order?: string | number;
  order_count?: string | number;
  clicks?: string | number;
  click?: string | number;
}

export interface RwCommissionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
  apiSource: string;
  /** 首单诊断：入库 merchantId / orderDate */
  sampleOrder?: { merchantId: string | null; orderDate: string; merchantName: string | null };
}

export interface RwFetchBundle {
  rows: RwCommissionRow[];
  source: string;
  triedSources: string[];
}

type RwMergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/** RW Performance 按商家+日的 Orders（与后台 Daily 一致） */
export interface RwMerchantDayOrderAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  performanceOrders: number;
}

/**
 * 从 transaction_details 推导按日 Orders（RW Performance：sign_id 拆分行计单）
 */
export function deriveRwPerformanceOrdersFromDetailRows(
  rows: RwCommissionRow[],
  startDate: string,
  endDate: string,
): RwMerchantDayOrderAgg[] {
  const byKey = new Map<
    string,
    { merchantId: string; merchantName: string; clickDate: string; keys: Set<string> }
  >();

  for (const row of rows) {
    const merchantId = resolveRwMerchantId(row);
    if (!merchantId) continue;

    const commission = parseMoney(
      row.cashback ?? row.sale_comm ?? row.commission ?? row.comm,
    );
    const orderAmount = parseMoney(
      row.sale_amount ?? row.order_amount ?? row.sale ?? row.amount,
    );
    if (commission <= 0 && orderAmount <= 0) continue;

    const clickDate = parseRwDetailStatDateStr(row, '');
    if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

    const dedupeKey = resolveRwPerformanceOrderDedupeKey_(row);
    if (!dedupeKey) continue;

    const mapKey = `${merchantId}|${clickDate}`;
    let bucket = byKey.get(mapKey);
    if (!bucket) {
      bucket = {
        merchantId,
        merchantName: String(row.merchant_name ?? row.advertiser_name ?? ''),
        clickDate,
        keys: new Set(),
      };
      byKey.set(mapKey, bucket);
    }
    bucket.keys.add(dedupeKey);
  }

  return [...byKey.values()].map((b) => ({
    merchantId: b.merchantId,
    merchantName: b.merchantName,
    clickDate: b.clickDate,
    performanceOrders: b.keys.size,
  }));
}

/** 明细行按日归因（RW Performance Transaction Date 优先，时间戳按东八区，无有效日期则丢弃） */
export function parseRwDetailStatDateStr(
  row: RwCommissionRow,
  _fallbackDate: string,
): string | null {
  for (const key of [
    'transaction_date',
    'order_ymd',
    'order_date',
    'date',
    'ymd',
  ] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    const d = parseRwPerformanceCalendarDay(v);
    if (d) return d;
  }

  for (const key of ['order_time', 'transaction_time'] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '') continue;
    const d = parseRwPerformanceCalendarDay(v);
    if (d) return d;
  }

  for (const key of ['validation_date', 'payment_ymd'] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    const d = parseRwPerformanceCalendarDay(v);
    if (d) return d;
  }

  return null;
}

/**
 * 从 transaction_details 按日+商家汇总（Performance 口径：佣金累加、sign_id 计单）
 */
export function buildRwDailyMetricsFromDetailRows(
  rows: RwCommissionRow[],
  startDate: string,
  endDate: string,
): Array<{
  merchantId: string;
  merchantName: string;
  clickDate: string;
  performanceOrders: number;
  performanceCommission: number;
  clicks: number;
}> {
  const byKey = new Map<
    string,
    {
      merchantId: string;
      merchantName: string;
      clickDate: string;
      orderKeys: Set<string>;
      performanceCommission: number;
    }
  >();

  for (const row of rows) {
    const merchantId = resolveRwMerchantId(row);
    if (!merchantId) continue;

    const commission = parseMoney(
      row.cashback ?? row.sale_comm ?? row.commission ?? row.comm,
    );
    const orderAmount = parseMoney(
      row.sale_amount ?? row.order_amount ?? row.sale ?? row.amount,
    );
    if (commission <= 0 && orderAmount <= 0) continue;

    const clickDate = parseRwDetailStatDateStr(row, '');
    if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

    let dedupeKey = resolveRwPerformanceOrderDedupeKey_(row);
    if (!dedupeKey) continue;

    const mapKey = `${merchantId}|${clickDate}`;
    let bucket = byKey.get(mapKey);
    if (!bucket) {
      bucket = {
        merchantId,
        merchantName: String(
          row.merchant_name ?? row.sitename ?? row.advertiser_name ?? '',
        ),
        clickDate,
        orderKeys: new Set(),
        performanceCommission: 0,
      };
      byKey.set(mapKey, bucket);
    }
    bucket.orderKeys.add(dedupeKey);
    bucket.performanceCommission += commission;
    const name = row.merchant_name ?? row.sitename ?? row.advertiser_name;
    if (!bucket.merchantName && name) {
      bucket.merchantName = String(name);
    }
  }

  return [...byKey.values()].map((b) => ({
    merchantId: b.merchantId,
    merchantName: b.merchantName,
    clickDate: b.clickDate,
    performanceOrders: b.orderKeys.size,
    performanceCommission: Math.round(b.performanceCommission * 100) / 100,
    clicks: 0,
  }));
}

/**
 * 拉取 Rewardoo 佣金（优先 transaction_details，504 时回退 commission/performance）
 */
export async function fetchRewardooCommissions(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<RwFetchBundle> {
  const result = await fetchRewardooCommissionData(
    apiToken,
    startDate,
    endDate,
    onProgress,
  );

  if (!result.rows.length) {
    throw new Error(
      `Rewardoo 采集失败：已尝试 ${result.triedSources.join(' → ')}，均无可用数据`,
    );
  }

  const primary = `medium/${RW_TRANSACTION_DETAILS_OP}`;
  if (result.source !== primary) {
    await onProgress?.(`RW 已回退至 ${result.source}（${primary} 不可用或超时）`);
  }

  return {
    source: result.source,
    rows: result.rows as RwCommissionRow[],
    triedSources: result.triedSources,
  };
}

/**
 * 转为统一订单结构
 */
export function normalizeRewardooOrders(
  rows: RwCommissionRow[],
  mappings: PlatformStatusMapping[],
  range?: { startDate: string; endDate: string },
): NormalizedOrder[] {
  const map = new Map<string, RwMergeEntry>();

  for (const row of rows) {
    const merchantId = resolveRwMerchantId(row);
    const merchantName = row.merchant_name ?? row.advertiser_name ?? null;
    const orderAmount = parseMoney(
      row.sale_amount ?? row.order_amount ?? row.sale ?? row.amount,
    );
    const commission = parseMoney(
      row.cashback ?? row.sale_comm ?? row.commission ?? row.comm,
    );
    const provisionalOrderId = resolveRwOrderId(row, range);
    if (commission <= 0 && orderAmount <= 0 && !provisionalOrderId) continue;

    const txDay = parseRwDetailStatDateStr(row, '');
    if (range) {
      if (!txDay || txDay < range.startDate || txDay > range.endDate) continue;
    }
    const orderDate = parseRwOrderDate(row, txDay, range?.endDate);
    if (!orderDate) continue;

    const externalOrderId = provisionalOrderId;
    const orderCount = parseOrderCount(row);

    if (!externalOrderId && merchantId && orderCount > 1) {
      expandAggregateOrders(
        map,
        row,
        merchantId,
        merchantName,
        orderAmount,
        commission,
        orderCount,
        mappings,
        range,
      );
      continue;
    }

    if (!externalOrderId) continue;

    const rawStatusStr = normalizeRwRawStatus(row.status);
    const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);

    mergeRwOrder(map, externalOrderId, {
      merchantId,
      merchantName,
      merchantSlug: resolveRwMerchantSlug(row),
      orderAmount,
      commission,
      rawStatus,
      normalizedStatus,
      orderDate,
      rawPayload: row,
    });
  }

  return [...map.values()].map((entry) => {
    const { breakdown, rawPayload, ...order } = entry;
    return {
      ...order,
      rawPayload: attachCommissionBreakdownToPayload(rawPayload, breakdown),
    };
  });
}

/** 汇总 API 行数与佣金（对账用） */
export function summarizeRwCommissionApi(
  rows: RwCommissionRow[],
  source: string,
  range?: { startDate: string; endDate: string },
): RwCommissionTotals {
  const normalized = normalizeRewardooOrders(rows, [], range);
  const totalCommission = normalized.reduce((s, o) => s + o.commission, 0);
  const first = normalized[0];
  return {
    apiListRows: rows.length,
    orderCount: normalized.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
    apiSource: source,
    sampleOrder: first
      ? {
          merchantId: first.merchantId,
          orderDate: first.orderDate.toISOString().slice(0, 10),
          merchantName: first.merchantName,
        }
      : undefined,
  };
}

/** Performance 商家汇总：按 orders 字段拆分为多条 */
function expandAggregateOrders(
  map: Map<string, RwMergeEntry>,
  row: RwCommissionRow,
  merchantId: string,
  merchantName: string | null,
  orderAmount: number,
  commission: number,
  orderCount: number,
  mappings: PlatformStatusMapping[],
  range?: { startDate: string; endDate: string },
) {
  const rawStatusStr = normalizeRwRawStatus(row.status);
  const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);
  const txDay = parseRwDetailStatDateStr(row, '');
  if (range && (!txDay || txDay < range.startDate || txDay > range.endDate)) return;
  const orderDate = parseRwOrderDate(row, txDay, range?.endDate);
  if (!orderDate) return;
  const perComm = commission / orderCount;
  const perAmount = orderAmount > 0 ? orderAmount / orderCount : 0;
  const dateKey = range?.endDate ?? 'range';

  for (let i = 0; i < orderCount; i += 1) {
    const externalOrderId = `rw_agg_${merchantId}_${dateKey}_${i}`;
    mergeRwOrder(map, externalOrderId, {
      merchantId,
      merchantName,
      merchantSlug: resolveRwMerchantSlug(row),
      orderAmount: perAmount,
      commission: perComm,
      rawStatus,
      normalizedStatus,
      orderDate,
      rawPayload: { ...row, _splitIndex: i, _splitTotal: orderCount },
    });
  }
}

function mergeRwOrder(
  map: Map<string, RwMergeEntry>,
  externalOrderId: string,
  next: Omit<NormalizedOrder, 'externalOrderId' | 'productId' | 'currency'>,
) {
  const existing = map.get(externalOrderId);
  if (existing) {
    existing.orderAmount += next.orderAmount;
    existing.commission += next.commission;
    existing.rawPayload = next.rawPayload;
    addToCommissionBreakdown(existing.breakdown, next.normalizedStatus, next.commission);
    mergeMixedOrderStatus(existing, {
      normalizedStatus: next.normalizedStatus,
      rawStatus: next.rawStatus,
    });
    if (!existing.merchantName && next.merchantName) existing.merchantName = next.merchantName;
    return;
  }

  const breakdown = emptyCommissionBreakdown();
  addToCommissionBreakdown(breakdown, next.normalizedStatus, next.commission);
  map.set(externalOrderId, {
    externalOrderId,
    merchantId: next.merchantId,
    merchantName: next.merchantName,
    merchantSlug: next.merchantSlug,
    productId: null,
    orderAmount: next.orderAmount,
    commission: next.commission,
    currency: 'USD',
    rawStatus: next.rawStatus,
    normalizedStatus: next.normalizedStatus,
    orderDate: next.orderDate,
    rawPayload: next.rawPayload,
    breakdown,
  });
}

/**
 * 解析 RW 入库订单号；与 affiliate 一致优先 order_id / rewardoo_id 合并拆单商品行。
 */
function resolveRwOrderId(
  row: RwCommissionRow,
  range?: { startDate: string; endDate: string },
): string {
  for (const key of ['order_id', 'rewardoo_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim() && String(v) !== '0') return String(v).trim();
  }

  for (const key of ['sign_id', 'txn_id', 'transaction_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim() && String(v) !== '0') return String(v).trim();
  }

  const merchantId = resolveRwMerchantId(row);
  if (!merchantId) return '';

  const hasAggregate =
    row.orders != null ||
    row.order != null ||
    row.order_count != null ||
    row.clicks != null ||
    row.click != null;
  if (!hasAggregate) return '';

  const dateKey =
    row.transaction_date ??
    row.order_ymd ??
    row.date ??
    row.ymd ??
    range?.endDate ??
    'range';
  const comm = parseMoney(row.sale_comm ?? row.commission ?? row.comm ?? row.cashback);
  const orders = parseOrderCount(row);
  return `rw_perf_${merchantId}_${String(dateKey).slice(0, 10)}_${orders}_${comm}`;
}

function parseOrderCount(row: RwCommissionRow): number {
  const raw = row.orders ?? row.order ?? row.order_count;
  if (raw == null || raw === '') return 1;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 解析 RW 商家 ID（与 affiliate 现网一致：优先 mid / m_id） */
function resolveRwMerchantId(row: RwCommissionRow): string | null {
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'norm_id'] as const) {
    const raw = row[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  const mcid = row.mcid;
  if (mcid != null && /^\d+$/.test(String(mcid).trim())) {
    return String(mcid).trim();
  }
  return null;
}

/** RW 商家 slug（mcid，用于与广告系列名中段对齐） */
function resolveRwMerchantSlug(row: RwCommissionRow): string | null {
  const mcid = row.mcid;
  if (mcid == null || String(mcid).trim() === '') return null;
  const s = String(mcid).trim().toLowerCase();
  return /^\d+$/.test(s) ? null : s;
}

/** RW 原始状态 → 可读字符串（与 Rewardoo API：new/effective/expired/pre_* 一致） */
function normalizeRwRawStatus(raw: string | number | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Pending';
  const lower = s.toLowerCase();
  if (lower === 'approved' || lower === 'effective' || s === '1') {
    return 'Approved';
  }
  if (
    lower === 'rejected' ||
    lower === 'expired' ||
    lower === 'canceled' ||
    lower === 'cancelled' ||
    s === '2'
  ) {
    return 'Rejected';
  }
  if (
    lower === 'new' ||
    lower === 'pending' ||
    lower === 'pre_effective' ||
    lower === 'pre_expired'
  ) {
    return 'Pending';
  }
  return 'Pending';
}

/**
 * 解析 RW 订单日期（与后台 Transaction Date / Channel 报表一致：transaction_date 优先，时间戳按东八区）
 */
function parseRwOrderDate(
  row: RwCommissionRow,
  txDay?: string | null,
  fallbackDate?: string,
): Date | null {
  const day = txDay ?? parseRwDetailStatDateStr(row, '');
  if (day) return new Date(`${day}T00:00:00.000Z`);

  if (fallbackDate && /^\d{4}-\d{2}-\d{2}$/.test(fallbackDate)) {
    return new Date(`${fallbackDate}T00:00:00.000Z`);
  }
  return null;
}

/** RW Performance 报表日期（Transaction Date 优先，与后台 Daily 一致） */
function parseRwPerformanceStatDate_(row: RwCommissionRow, fallbackDate?: string): Date {
  const parsed = parseRwOrderDate(row, parseRwDetailStatDateStr(row, ''), fallbackDate);
  return parsed ?? new Date();
}

/**
 * RW Performance 计单去重（与后台 Daily Orders 一致：优先 sign_id 拆分行，无 sign_id 再用 order_id）
 */
function resolveRwPerformanceOrderDedupeKey_(row: RwCommissionRow): string {
  const signId = row.sign_id ?? row.txn_id ?? row.transaction_id;
  if (signId != null && String(signId).trim() !== '' && String(signId) !== '0') {
    return `sign:${String(signId).trim()}`;
  }
  const orderId = row.order_id ?? row.rewardoo_id;
  if (orderId != null && String(orderId).trim() !== '' && String(orderId) !== '0') {
    return String(orderId).trim();
  }
  return '';
}

function resolveRwOrderDedupeKey_(row: RwCommissionRow): string {
  const orderId = row.order_id ?? row.rewardoo_id;
  if (orderId != null && String(orderId).trim() !== '' && String(orderId) !== '0') {
    return String(orderId).trim();
  }
  const signId = row.sign_id ?? row.txn_id ?? row.transaction_id;
  if (signId != null && String(signId).trim() !== '' && String(signId) !== '0') {
    return `sign:${String(signId).trim()}`;
  }
  return '';
}

function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
