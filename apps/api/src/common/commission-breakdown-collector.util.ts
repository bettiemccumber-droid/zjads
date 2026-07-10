import { NormalizedStatus } from '@prisma/client';
import { CommissionBreakdown } from './order-commission-buckets.util';

/** 空佣金拆分桶 */
export function emptyCommissionBreakdown(): CommissionBreakdown {
  return { approved: 0, pending: 0, rejected: 0 };
}

/**
 * 按子行状态累加佣金到拆分桶
 */
export function addToCommissionBreakdown(
  breakdown: CommissionBreakdown,
  status: NormalizedStatus,
  commission: number,
): void {
  if (status === NormalizedStatus.approved) breakdown.approved += commission;
  else if (status === NormalizedStatus.rejected) breakdown.rejected += commission;
  else breakdown.pending += commission;
}

/**
 * 合并同单多子行时更新整单 normalizedStatus（rejected 优先于 approved）
 */
export function mergeMixedOrderStatus(
  existing: { normalizedStatus: NormalizedStatus; rawStatus: string },
  next: { normalizedStatus: NormalizedStatus; rawStatus: string },
): void {
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
}

/**
 * 写入 rawPayload._commissionBreakdown（采集入库供结算/监控读取）
 */
export function attachCommissionBreakdownToPayload(
  rawPayload: unknown,
  breakdown: CommissionBreakdown,
): unknown {
  const base =
    rawPayload && typeof rawPayload === 'object'
      ? { ...(rawPayload as Record<string, unknown>) }
      : {};
  return {
    ...base,
    _commissionBreakdown: {
      approved: roundCollectorMoney(breakdown.approved),
      pending: roundCollectorMoney(breakdown.pending),
      rejected: roundCollectorMoney(breakdown.rejected),
    },
  };
}

/** 采集阶段金额四舍五入 */
export function roundCollectorMoney(n: number): number {
  return Math.round(n * 100) / 100;
}
