import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import { parseAffiliateOrderDateUtc8 } from '../common/affiliate-order-date.util';
import {
  fetchRewardooCommissionData,
  RwCommissionOp,
} from './rewardoo-api.util';
import { NormalizedOrder } from './types';
import { normalizeStatus } from './status-normalizer';

/** Rewardoo API 单行（订单明细或 Performance 商家汇总） */
export interface RwCommissionRow {
  order_id?: string | number;
  transaction_id?: string | number;
  sign_id?: string | number;
  txn_id?: string | number;
  m_id?: string | number;
  mid?: string | number;
  merchant_id?: string | number;
  merchant_name?: string;
  advertiser_name?: string;
  sale_amount?: string | number;
  amount?: string | number;
  order_amount?: string | number;
  sale?: string | number;
  commission?: string | number;
  comm?: string | number;
  cashback?: string | number;
  status?: string | number;
  order_time?: string | number;
  transaction_time?: string | number;
  order_ymd?: string;
  transaction_date?: string;
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
}

export interface RwFetchBundle {
  rows: RwCommissionRow[];
  source: string;
  triedSources: string[];
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
    const commission = parseMoney(row.commission ?? row.comm ?? row.cashback);
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
  return {
    apiListRows: rows.length,
    orderCount: normalized.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
    apiSource: source,
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
  next: Omit<NormalizedOrder, 'externalOrderId' | 'merchantSlug' | 'productId' | 'currency'>,
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
    merchantSlug: null,
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

/** 解析 RW 订单号；Performance 汇总行生成 synthetic id */
function resolveRwOrderId(
  row: RwCommissionRow,
  range?: { startDate: string; endDate: string },
): string {
  for (const key of ['order_id', 'transaction_id', 'sign_id', 'txn_id'] as const) {
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

  const dateKey = row.order_ymd ?? row.date ?? row.ymd ?? range?.endDate ?? 'range';
  return `rw_perf_${merchantId}_${dateKey}`;
}

function parseOrderCount(row: RwCommissionRow): number {
  const raw = row.orders ?? row.order ?? row.order_count;
  if (raw == null || raw === '') return 1;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** 解析 RW 商家 ID */
function resolveRwMerchantId(row: RwCommissionRow): string | null {
  const raw = row.m_id ?? row.mid ?? row.merchant_id;
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).trim();
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

/** 解析 RW 订单日期（优先交易日期字段） */
function parseRwOrderDate(row: RwCommissionRow, fallbackDate?: string): Date {
  for (const key of [
    'order_time',
    'transaction_time',
    'order_ymd',
    'transaction_date',
    'date',
    'ymd',
  ] as const) {
    const v = row[key];
    if (v != null && String(v).trim()) {
      return parseAffiliateOrderDateUtc8(v);
    }
  }
  if (row.payment_ymd) {
    return parseAffiliateOrderDateUtc8(row.payment_ymd);
  }
  if (fallbackDate) {
    return parseAffiliateOrderDateUtc8(fallbackDate);
  }
  return new Date();
}

function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
