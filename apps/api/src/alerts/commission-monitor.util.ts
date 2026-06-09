/** 佣金监控规则（与 DB CommissionAlertRule 数值字段对应） */
export interface CommissionMonitorRule {
  rejectedAmountThreshold: number;
  rejectedRateThreshold: number;
  minRejectedOrders: number;
  minOrdersForRate: number;
  minRejectedForRate: number;
}

import type { MerchantCommissionAgg } from '../common/commission-aggregate.util';

export type { MerchantCommissionAgg };

export type CommissionSeverity = 'warning' | 'critical';

export interface CommissionEvaluateResult {
  hit: boolean;
  severity: CommissionSeverity;
  reasons: string[];
}

/**
 * 判断是否应触发佣金失效告警
 */
function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundRate(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateCommissionRisk(
  row: MerchantCommissionAgg,
  rule: CommissionMonitorRule,
): CommissionEvaluateResult {
  const reasons: string[] = [];
  const rejectedCommission = roundMoney(row.rejectedCommission);
  const rejectionRate = roundRate(row.rejectionRate);

  if (rejectedCommission <= 0 || row.rejectedOrderCount < rule.minRejectedOrders) {
    return { hit: false, severity: 'warning', reasons };
  }

  const amountTh = roundMoney(rule.rejectedAmountThreshold);
  const rateTh = roundRate(rule.rejectedRateThreshold);
  const minRejectedForRate = roundMoney(rule.minRejectedForRate);
  const hitAmount = rejectedCommission >= amountTh;
  const hitRate =
    row.orderCount >= rule.minOrdersForRate &&
    rejectedCommission >= minRejectedForRate &&
    rejectionRate >= rateTh;

  if (hitAmount) {
    reasons.push(`失效佣金 $${rejectedCommission.toFixed(2)} ≥ $${amountTh.toFixed(2)}`);
  }
  if (hitRate) {
    reasons.push(
      `失效率 ${rejectionRate.toFixed(1)}% ≥ ${rateTh.toFixed(1)}%（失效佣金占总额；${row.rejectedOrderCount}/${row.orderCount} 单被拒）`,
    );
  }

  if (!hitAmount && !hitRate) {
    return { hit: false, severity: 'warning', reasons };
  }

  const severity: CommissionSeverity =
    hitAmount && rejectedCommission >= amountTh * 2
      ? 'critical'
      : hitRate && rejectionRate >= rateTh * 1.5
        ? 'critical'
        : 'warning';

  return { hit: true, severity, reasons };
}

export function defaultMonitorRule(): CommissionMonitorRule {
  return {
    rejectedAmountThreshold: 100,
    rejectedRateThreshold: 25,
    minRejectedOrders: 1,
    minOrdersForRate: 1,
    minRejectedForRate: 1,
  };
}

export function ruleFromDb(rule: {
  rejectedAmountThreshold: unknown;
  rejectedRateThreshold: unknown;
  minRejectedOrders?: number | null;
  minOrdersForRate?: number | null;
  minRejectedForRate?: unknown;
}): CommissionMonitorRule {
  return {
    rejectedAmountThreshold: Number(rule.rejectedAmountThreshold),
    rejectedRateThreshold: Number(rule.rejectedRateThreshold),
    minRejectedOrders: rule.minRejectedOrders ?? 1,
    minOrdersForRate: rule.minOrdersForRate ?? 1,
    minRejectedForRate: Number(rule.minRejectedForRate ?? 1),
  };
}
