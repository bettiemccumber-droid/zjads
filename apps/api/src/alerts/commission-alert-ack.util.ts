/** 确认快照与当前指标（用于判断是否需要重新 open） */
export interface CommissionAlertAckSnapshot {
  ackedRejectedCommission?: number | null;
  ackedRejectedOrderCount?: number | null;
  ackedRejectionRate?: number | null;
}

export interface CommissionAlertCurrentMetrics {
  rejectedCommission: number;
  rejectedOrderCount: number;
  rejectionRate: number;
}

function roundMoney(v: number) {
  return Math.round(v * 100) / 100;
}

function roundRate(v: number) {
  return Math.round(v * 10) / 10;
}

/**
 * 已确认告警是否在重新检查后需要再次提醒
 * 规则：失效佣金、失效单数、失效率任一项严格增加则重新 open
 */
export function shouldReopenAckedAlert(
  acked: CommissionAlertAckSnapshot,
  current: CommissionAlertCurrentMetrics,
): boolean {
  if (
    acked.ackedRejectedCommission == null &&
    acked.ackedRejectedOrderCount == null &&
    acked.ackedRejectionRate == null
  ) {
    /** 旧数据无快照：保持已确认，避免采集后反复打扰 */
    return false;
  }

  const ackComm = roundMoney(Number(acked.ackedRejectedCommission ?? 0));
  const curComm = roundMoney(current.rejectedCommission);
  const ackOrders = acked.ackedRejectedOrderCount ?? 0;
  const ackRate = roundRate(Number(acked.ackedRejectionRate ?? 0));
  const curRate = roundRate(current.rejectionRate);

  return (
    curComm > ackComm ||
    current.rejectedOrderCount > ackOrders ||
    curRate > ackRate
  );
}
