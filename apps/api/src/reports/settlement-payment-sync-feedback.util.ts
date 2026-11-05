import type { CommissionHalf } from './settlement-commission-persist.util';

/**
 * 判断打款同步是否应写入库（全 0 且无 API 行时跳过，避免覆盖手工录入）
 */
export function shouldPersistPaymentSyncLine(
  receivable: CommissionHalf,
  actual: CommissionHalf,
  apiRowCount: number,
): boolean {
  if (apiRowCount > 0) return true;
  const sum =
    receivable.usdH1 +
    receivable.usdH2 +
    actual.usdH1 +
    actual.usdH2;
  return sum > 0;
}

/**
 * 有打款行但汇总为 0 时的提示（状态/日期与结算月不匹配）
 */
export function zeroAggregateHint(month: string, apiRowCount: number): string | undefined {
  if (apiRowCount <= 0) {
    return `${month} 打款 API 返回 0 行，未写入库（可用手工调整或核对 Token/月份）`;
  }
  return `${apiRowCount} 条打款未计入 ${month}（Request/Paid 日期或状态与后台不一致）`;
}
