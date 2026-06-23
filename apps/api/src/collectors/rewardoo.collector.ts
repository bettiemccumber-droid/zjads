import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import { parseAffiliateOrderDateUtc8 } from '../common/affiliate-order-date.util';
import { fetchRewardooTransactionPages } from './rewardoo-api.util';
import { NormalizedOrder } from './types';
import { normalizeStatus } from './status-normalizer';

/** Rewardoo TransactionDetails 单行（字段名兼容多种返回） */
export interface RwTransactionRow {
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
  commission?: string | number;
  comm?: string | number;
  cashback?: string | number;
  status?: string | number;
  order_time?: string | number;
  transaction_time?: string | number;
  order_ymd?: string;
  transaction_date?: string;
  payment_ymd?: string;
}

export interface RwCommissionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 拉取 Rewardoo 订单/佣金明细（TransactionDetails）
 * 口径：与后台 Performance「Transaction Date」一致；非 CommissionSummary 结算口径
 */
export async function fetchRewardooCommissions(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<RwTransactionRow[]> {
  const raw = await fetchRewardooTransactionPages(
    apiToken,
    startDate,
    endDate,
    onProgress,
  );
  return raw as RwTransactionRow[];
}

/**
 * 转为统一订单结构（同一 order_id 合并佣金）
 */
export function normalizeRewardooOrders(
  rows: RwTransactionRow[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const map = new Map<string, NormalizedOrder>();

  for (const row of rows) {
    const externalOrderId = resolveRwOrderId(row);
    if (!externalOrderId) continue;

    const merchantId = resolveRwMerchantId(row);
    const merchantName = row.merchant_name ?? row.advertiser_name ?? null;
    const orderAmount = parseMoney(row.sale_amount ?? row.order_amount ?? row.amount);
    const commission = parseMoney(row.commission ?? row.comm ?? row.cashback);
    if (commission <= 0 && orderAmount <= 0) continue;

    const rawStatusStr = normalizeRwRawStatus(row.status);
    const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);
    const orderDate = parseRwOrderDate(row);

    const existing = map.get(externalOrderId);
    if (existing) {
      existing.orderAmount += orderAmount;
      existing.commission += commission;
      existing.rawPayload = row;
      if (normalizedStatus === NormalizedStatus.rejected) {
        existing.normalizedStatus = NormalizedStatus.rejected;
        existing.rawStatus = rawStatus;
      } else if (
        existing.normalizedStatus !== NormalizedStatus.rejected &&
        normalizedStatus === NormalizedStatus.approved
      ) {
        existing.normalizedStatus = NormalizedStatus.approved;
        existing.rawStatus = rawStatus;
      }
      continue;
    }

    map.set(externalOrderId, {
      externalOrderId,
      merchantId,
      merchantName,
      merchantSlug: null,
      productId: null,
      orderAmount,
      commission,
      currency: 'USD',
      rawStatus,
      normalizedStatus,
      orderDate,
      rawPayload: row,
    });
  }

  return [...map.values()];
}

/** 汇总 API 行数与佣金（对账用） */
export function summarizeRwCommissionApi(rows: RwTransactionRow[]): RwCommissionTotals {
  const normalized = normalizeRewardooOrders(rows, []);
  const totalCommission = normalized.reduce((s, o) => s + o.commission, 0);
  return {
    apiListRows: rows.length,
    orderCount: normalized.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

/** 解析 RW 订单号 */
function resolveRwOrderId(row: RwTransactionRow): string {
  for (const key of ['order_id', 'transaction_id', 'sign_id', 'txn_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

/** 解析 RW 商家 ID */
function resolveRwMerchantId(row: RwTransactionRow): string | null {
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
function parseRwOrderDate(row: RwTransactionRow): Date {
  for (const key of [
    'order_time',
    'transaction_time',
    'order_ymd',
    'transaction_date',
  ] as const) {
    const v = row[key];
    if (v != null && String(v).trim()) {
      return parseAffiliateOrderDateUtc8(v);
    }
  }
  if (row.payment_ymd) {
    return parseAffiliateOrderDateUtc8(row.payment_ymd);
  }
  return new Date();
}

function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
