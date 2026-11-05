import type { CommissionHalf } from './settlement-commission-persist.util';

/**
 * 判断打款同步是否应写入库（汇总为 0 时不写入，避免历史 API 行把手工数覆盖成 0）
 */
export function shouldPersistPaymentSyncLine(
  receivable: CommissionHalf,
  actual: CommissionHalf,
  _apiRowCount: number,
): boolean {
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

/**
 * LinkBux Payment Details 专用提示（无 Request Date 字段）
 */
export function linkbuxZeroAggregateHint(
  month: string,
  fetchedRowCount: number,
  commissionRowCount: number,
): string {
  if (fetchedRowCount <= 0) {
    return `${month} LinkBux 打款 API 无返回行（可用手工调整或核对 Token）`;
  }
  if (commissionRowCount > 0) {
    return `${month} 实收/应收为 0：明细 ${commissionRowCount} 行 settlement/paid 不在该月；若后台有 Pending，请核对付款历史接口是否返回当月 payment_id`;
  }
  return `${month} 实收/应收为 0（拉取 ${fetchedRowCount} 条多为历史付款记录，未匹配当月 Pending 或 paid_date）`;
}
