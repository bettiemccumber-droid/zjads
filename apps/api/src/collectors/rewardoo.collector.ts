import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import { parseAffiliateOrderDateUtc } from '../common/affiliate-order-date.util';
import {
  fetchRewardooCommissionData,
  RwCommissionOp,
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

/** RW Performance 按商家+日的 Orders（与后台 Daily 一致） */
export interface RwMerchantDayOrderAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  performanceOrders: number;
}

/**
 * 从 transaction_details 推导 Performance Orders：merchant+日按 order_id+sign_id 去重。
 * 同一 order_id 多行（拆佣金）与 RW Performance Daily 一致。
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
      row.sale_comm ?? row.commission ?? row.comm ?? row.cashback,
    );
    const orderAmount = parseMoney(
      row.sale_amount ?? row.order_amount ?? row.sale ?? row.amount,
    );
    if (commission <= 0 && orderAmount <= 0) continue;

    const clickDate = parseRwOrderDate(row, endDate).toISOString().slice(0, 10);
    if (clickDate < startDate || clickDate > endDate) continue;

    const orderIdRaw = row.order_id;
    const orderId =
      orderIdRaw != null && String(orderIdRaw).trim() !== '' && String(orderIdRaw) !== '0'
        ? String(orderIdRaw).trim()
        : '';
    const signIdRaw = row.sign_id;
    const signId =
      signIdRaw != null && String(signIdRaw).trim() !== '' && String(signIdRaw) !== '0'
        ? String(signIdRaw).trim()
        : '';
    const txnIdRaw = row.transaction_id ?? row.txn_id ?? row.rewardoo_id;
    const txnId =
      txnIdRaw != null && String(txnIdRaw).trim() !== '' && String(txnIdRaw) !== '0'
        ? String(txnIdRaw).trim()
        : '';

    /** 同一 order_id 多行（拆佣金）在 RW Performance 仍计多单时，用 sign/txn 细分 */
    let dedupeKey = '';
    if (orderId && (signId || txnId)) {
      dedupeKey = `oid:${orderId}|${signId ? `sign:${signId}` : `txn:${txnId}`}`;
    } else if (orderId) {
      dedupeKey = `oid:${orderId}`;
    } else if (signId) {
      dedupeKey = `sign:${signId}`;
    } else if (txnId) {
      dedupeKey = `txn:${txnId}`;
    }
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

/**
 * 拉取 Rewardoo 佣金（transaction 优先，空则回退 performance/merchant 等）
 */
export async function fetchRewardooCommissions(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<RwFetchBundle> {
  const { source, rows, triedSources } = await fetchRewardooCommissionData(
    apiToken,
    startDate,
    endDate,
    onProgress,
  );
  return { source, rows: rows as RwCommissionRow[], triedSources };
}

/**
 * 转为统一订单结构
 */
export function normalizeRewardooOrders(
  rows: RwCommissionRow[],
  mappings: PlatformStatusMapping[],
  range?: { startDate: string; endDate: string },
): NormalizedOrder[] {
  const map = new Map<string, NormalizedOrder>();

  for (const row of rows) {
    const merchantId = resolveRwMerchantId(row);
    const merchantName = row.merchant_name ?? row.advertiser_name ?? null;
    const orderAmount = parseMoney(
      row.sale_amount ?? row.order_amount ?? row.sale ?? row.amount,
    );
    const commission = parseMoney(
      row.sale_comm ?? row.commission ?? row.comm ?? row.cashback,
    );
    if (commission <= 0 && orderAmount <= 0) continue;

    const externalOrderId = resolveRwOrderId(row, range);
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
    const orderDate = parseRwOrderDate(row, range?.endDate);

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

  return [...map.values()];
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
  map: Map<string, NormalizedOrder>,
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
  const orderDate = parseRwOrderDate(row, range?.endDate);
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
  map: Map<string, NormalizedOrder>,
  externalOrderId: string,
  next: Omit<NormalizedOrder, 'externalOrderId' | 'productId' | 'currency'>,
) {
  const existing = map.get(externalOrderId);
  if (existing) {
    existing.orderAmount += next.orderAmount;
    existing.commission += next.commission;
    existing.rawPayload = next.rawPayload;
    if (next.normalizedStatus === NormalizedStatus.rejected) {
      existing.normalizedStatus = NormalizedStatus.rejected;
      existing.rawStatus = next.rawStatus;
    } else if (
      existing.normalizedStatus !== NormalizedStatus.rejected &&
      next.normalizedStatus === NormalizedStatus.approved
    ) {
      existing.normalizedStatus = NormalizedStatus.approved;
      existing.rawStatus = next.rawStatus;
    }
    return;
  }

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
  });
}

/**
 * 解析 RW 入库订单号；优先 sign_id（佣金明细行），订单数展示走 Performance API。
 */
function resolveRwOrderId(
  row: RwCommissionRow,
  range?: { startDate: string; endDate: string },
): string {
  for (const key of ['sign_id', 'txn_id', 'transaction_id', 'rewardoo_id', 'order_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
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

/** RW 原始状态 → 可读字符串 */
function normalizeRwRawStatus(raw: string | number | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Pending';
  const upper = s.toUpperCase();
  if (upper === 'APPROVED' || upper === 'EFFECTIVE' || s === '1') return 'Approved';
  if (upper === 'REJECTED' || upper === 'CANCELED' || upper === 'CANCELLED' || s === '2') {
    return 'Rejected';
  }
  return 'Pending';
}

/**
 * 解析 RW 订单日期（与 Rewardoo Performance Daily / transaction_details 一致）
 * 1. 优先交易发生日（transaction_date / order_ymd / date）
 * 2. order_time 时间戳按 UTC 自然日
 * 3. validation_date / payment_ymd 仅作兜底（结算日≠交易日）
 */
function parseRwOrderDate(row: RwCommissionRow, fallbackDate?: string): Date {
  for (const key of [
    'transaction_date',
    'order_ymd',
    'order_date',
    'date',
    'ymd',
  ] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    return parseAffiliateOrderDateUtc(v);
  }

  for (const key of ['order_time', 'transaction_time'] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '') continue;
    return parseAffiliateOrderDateUtc(v);
  }

  for (const key of ['validation_date', 'payment_ymd'] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    return parseAffiliateOrderDateUtc(v);
  }

  if (fallbackDate) {
    return parseAffiliateOrderDateUtc(fallbackDate);
  }
  return new Date();
}

function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
