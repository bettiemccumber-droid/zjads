import { NormalizedStatus } from '@prisma/client';

/** 单笔订单按状态拆分的佣金（LH 等同单多 SKU 混状态时写入 rawPayload） */
export interface CommissionBreakdown {
  approved: number;
  pending: number;
  rejected: number;
}

type OrderLike = {
  commission: unknown;
  normalizedStatus: NormalizedStatus;
  rawPayload?: unknown;
};

/**
 * 从 rawPayload 读取采集时写入的佣金拆分
 */
export function extractCommissionBreakdown(rawPayload: unknown): CommissionBreakdown | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const b = (rawPayload as Record<string, unknown>)._commissionBreakdown;
  if (!b || typeof b !== 'object') return null;
  const row = b as Record<string, unknown>;
  const approved = Number(row.approved);
  const pending = Number(row.pending);
  const rejected = Number(row.rejected);
  if (![approved, pending, rejected].every((n) => Number.isFinite(n))) return null;
  return { approved, pending, rejected };
}

/**
 * 解析订单在各状态桶中的佣金；无拆分时按整单 normalizedStatus 归类（兼容历史数据）
 */
export function resolveOrderCommissionBuckets(order: OrderLike): CommissionBreakdown {
  const breakdown = extractCommissionBreakdown(order.rawPayload);
  if (breakdown) {
    return {
      approved: round2(breakdown.approved),
      pending: round2(breakdown.pending),
      rejected: round2(breakdown.rejected),
    };
  }

  const comm = round2(Number(order.commission));
  const isPendingLike =
    order.normalizedStatus === NormalizedStatus.pending ||
    order.normalizedStatus === NormalizedStatus.unknown;
  return {
    approved: order.normalizedStatus === NormalizedStatus.approved ? comm : 0,
    pending: isPendingLike ? comm : 0,
    rejected: order.normalizedStatus === NormalizedStatus.rejected ? comm : 0,
  };
}

/** 订单是否含失效（拒付）佣金 */
export function orderHasRejectedCommission(order: OrderLike): boolean {
  return resolveOrderCommissionBuckets(order).rejected > 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
