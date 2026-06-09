import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';
import { CommissionBreakdown } from '../common/order-commission-buckets.util';
import { fetchLhByCommissionSlots } from './linkhaitao-api.util';
import { NormalizedOrder } from './types';
import { normalizeStatus } from './status-normalizer';

/** LH 合并过程中的内部结构 */
type LhMergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/** cashback2 API 返回的单条佣金/订单行 */
export interface LhCommissionRow {
  order_id?: string;
  sign_id?: string;
  m_id?: string | number;
  mcid?: string | number;
  mid?: string | number;
  advertiser_name?: string;
  merchant_name?: string;
  order_time?: string;
  sale_amount?: string | number;
  amount?: string | number;
  cashback?: string | number;
  commission?: string | number;
  status?: string;
  tagcode?: string;
  tagcode2?: string;
}

export interface LhCommissionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 拉取 LH 佣金/订单明细（cashback2，与旧 affiliate 项目一致）
 */
export async function fetchLinkHaitaoCommissions(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (slotIndex: number, totalSlots: number) => void | Promise<void>,
): Promise<LhCommissionRow[]> {
  return fetchLhByCommissionSlots<LhCommissionRow>(
    apiToken,
    startDate,
    endDate,
    onProgress,
  );
}

/**
 * 转为统一订单结构；同一 order_id 合并佣金，并按子行状态拆分失效/待确认金额
 */
export function normalizeLinkHaitaoOrders(
  rows: LhCommissionRow[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const map = new Map<string, LhMergeEntry>();

  for (const row of rows) {
    const externalOrderId = String(row.order_id ?? row.sign_id ?? '').trim();
    if (!externalOrderId) continue;

    const merchantIdRaw = row.m_id ?? row.mcid;
    const merchantId = merchantIdRaw != null ? String(merchantIdRaw) : null;
    const merchantName = row.advertiser_name ?? row.merchant_name ?? null;
    const orderAmount = parseMoney(row.sale_amount ?? row.amount);
    const commission = parseMoney(row.cashback ?? row.commission);
    const rawStatusStr = normalizeLhRawStatus(row.status);
    const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);
    const orderDate = parseLhOrderDate(row.order_time);

    const existing = map.get(externalOrderId);
    if (existing) {
      existing.orderAmount += orderAmount;
      existing.commission += commission;
      existing.rawPayload = row;
      addCommissionToBreakdown(existing.breakdown, normalizedStatus, commission);
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
    } else {
      const breakdown = emptyBreakdown();
      addCommissionToBreakdown(breakdown, normalizedStatus, commission);
      map.set(externalOrderId, {
        externalOrderId,
        merchantId,
        merchantName,
        merchantSlug: row.tagcode ? String(row.tagcode) : null,
        productId: null,
        orderAmount,
        commission,
        currency: 'USD',
        rawStatus,
        normalizedStatus,
        orderDate,
        rawPayload: row,
        breakdown,
      });
    }
  }

  return [...map.values()].map((entry) => {
    const { breakdown, rawPayload, ...order } = entry;
    return {
      ...order,
      rawPayload: attachCommissionBreakdown(rawPayload, breakdown),
    };
  });
}

/**
 * 统计 LH 佣金 API 汇总
 */
export function summarizeLhCommissionApi(rows: LhCommissionRow[]): LhCommissionTotals {
  const normalized = normalizeLinkHaitaoOrders(rows, []);
  const totalCommission = normalized.reduce((s, o) => s + o.commission, 0);
  return {
    apiListRows: rows.length,
    orderCount: normalized.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

function emptyBreakdown(): CommissionBreakdown {
  return { approved: 0, pending: 0, rejected: 0 };
}

function addCommissionToBreakdown(
  breakdown: CommissionBreakdown,
  status: NormalizedStatus,
  commission: number,
) {
  if (status === NormalizedStatus.approved) breakdown.approved += commission;
  else if (status === NormalizedStatus.rejected) breakdown.rejected += commission;
  else breakdown.pending += commission;
}

function attachCommissionBreakdown(rawPayload: unknown, breakdown: CommissionBreakdown): unknown {
  const base =
    rawPayload && typeof rawPayload === 'object'
      ? { ...(rawPayload as Record<string, unknown>) }
      : {};
  return {
    ...base,
    _commissionBreakdown: {
      approved: roundMoney(breakdown.approved),
      pending: roundMoney(breakdown.pending),
      rejected: roundMoney(breakdown.rejected),
    },
  };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** LH 原始状态 → 可读字符串（再交给 status-normalizer） */
function normalizeLhRawStatus(raw: string | undefined): string {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'approved' || s === 'effective') return 'Approved';
  if (s === 'rejected' || s === 'expired' || s === 'canceled' || s === 'cancelled') {
    return 'Rejected';
  }
  return 'Pending';
}

function parseMoney(raw: string | number | undefined): number {
  const n = parseFloat(String(raw ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function parseLhOrderDate(raw: string | undefined): Date {
  if (!raw) return new Date();
  const day = raw.split(' ')[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new Date(`${day}T00:00:00.000Z`);
  }
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  return new Date();
}
