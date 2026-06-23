import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import { parseAffiliateOrderDateUtc8 } from '../common/affiliate-order-date.util';
import { fetchRewardooCommissionSummaryPages } from './rewardoo-api.util';
import { NormalizedOrder } from './types';
import { normalizeStatus } from './status-normalizer';

/** Rewardoo CommissionSummary 单行 */
export interface RwCommissionSummaryRow {
  m_id?: string | number;
  amount?: string | number;
  payment_ymd?: string;
  order_ym?: string;
  note?: string;
  payment_sn?: string;
  withdrawal_id?: string | number;
}

export interface RwCommissionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 拉取 Rewardoo 已确认佣金汇总（CommissionSummary）
 * 口径：商家已确认佣金；不含 Pending/Rejected 明细
 */
export async function fetchRewardooCommissions(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<RwCommissionSummaryRow[]> {
  const raw = await fetchRewardooCommissionSummaryPages(
    apiToken,
    startDate,
    endDate,
    onProgress,
  );
  return raw as RwCommissionSummaryRow[];
}

/**
 * 转为统一订单结构（每行 payment_sn 视为一条结算记录）
 */
export function normalizeRewardooOrders(
  rows: RwCommissionSummaryRow[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const map = new Map<string, NormalizedOrder>();

  for (const row of rows) {
    const merchantId = row.m_id != null ? String(row.m_id).trim() : '';
    const commission = parseMoney(row.amount);
    if (!merchantId || commission <= 0) continue;

    const paymentSn = String(row.payment_sn ?? '').trim();
    const externalOrderId =
      paymentSn ||
      [
        String(row.withdrawal_id ?? '').trim(),
        merchantId,
        String(row.payment_ymd ?? '').trim(),
        String(row.order_ym ?? '').trim(),
        commission.toFixed(4),
      ]
        .filter(Boolean)
        .join('_');

    const rawStatusStr = 'approved';
    const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);
    const orderDate = parseAffiliateOrderDateUtc8(row.payment_ymd);

    const existing = map.get(externalOrderId);
    if (existing) {
      existing.commission += commission;
      existing.orderAmount += commission;
      existing.rawPayload = row;
      continue;
    }

    map.set(externalOrderId, {
      externalOrderId,
      merchantId,
      merchantName: null,
      merchantSlug: null,
      productId: null,
      orderAmount: commission,
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
export function summarizeRwCommissionApi(rows: RwCommissionSummaryRow[]): RwCommissionTotals {
  let totalCommission = 0;
  for (const row of rows) {
    totalCommission += parseMoney(row.amount);
  }
  return {
    apiListRows: rows.length,
    orderCount: rows.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

function parseMoney(v: string | number | undefined | null): number {
  if (v == null || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
