import { isRwClickPseudoMerchant } from '../collectors/rewardoo-clicks';
import { MerchantCommissionAgg } from './commission-aggregate.util';
import { deploymentUnitKey } from './deployment-unit.util';

/** RW 商家 Performance 聚合键：merchantId + 投放单元 */
export function rwMerchantAggKey(
  merchantId: string,
  displayName: string,
  affiliateAlias: string,
): string {
  return `${merchantId}|${deploymentUnitKey('rewardoo', displayName, affiliateAlias)}`;
}

export interface RwPerformanceMerchantTotals {
  merchantId: string;
  merchantName: string;
  affiliateAlias: string;
  displayName: string;
  platformName: string;
  orderCount: number;
  totalCommission: number;
}

export interface RwClickDailyPerformanceRow {
  merchantId: string;
  merchantName: string | null;
  performanceOrders: number;
  performanceCommission: unknown;
  channelAccount: {
    affiliateAlias: string | null;
    displayName?: string | null;
    platform: { code: string; name: string } | null;
  };
}

/**
 * 按商家+投放单元汇总 RW Performance（同 displayName+alias 的多 Channel 先加总）
 */
export function aggregateRwPerformanceByMerchant(
  rows: RwClickDailyPerformanceRow[],
): Map<string, RwPerformanceMerchantTotals> {
  const map = new Map<string, RwPerformanceMerchantTotals>();

  for (const c of rows) {
    if (c.channelAccount.platform?.code !== 'rewardoo') continue;
    if (isRwClickPseudoMerchant(c.merchantId)) continue;

    const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
    const displayName = (c.channelAccount.displayName || '').trim();
    const key = rwMerchantAggKey(c.merchantId, displayName, alias);
    const prev = map.get(key) ?? {
      merchantId: c.merchantId,
      merchantName: c.merchantName ?? '',
      affiliateAlias: alias,
      displayName,
      platformName: c.channelAccount.platform.name,
      orderCount: 0,
      totalCommission: 0,
    };

    prev.orderCount += c.performanceOrders;
    prev.totalCommission += Number(c.performanceCommission);
    if (!prev.merchantName && c.merchantName) prev.merchantName = c.merchantName;
    map.set(key, prev);
  }

  return map;
}

/**
 * 将 RW 商家总佣金/订单数对齐为 Performance 逐日汇总（每个投放单元每商家只覆盖一次）
 */
export function applyRwPerformanceCommissionOverlay(
  merchants: MerchantCommissionAgg[],
  perfByKey: Map<string, RwPerformanceMerchantTotals>,
): MerchantCommissionAgg[] {
  if (perfByKey.size === 0) return merchants;

  const result = merchants.map((m) => {
    if (m.platformCode !== 'rewardoo') return m;

    const displayName = m.channelDisplayName ?? '';
    const key = rwMerchantAggKey(m.merchantId, displayName, m.affiliateAlias);
    const perf = perfByKey.get(key);
    if (!perf) return m;

    const confirmed = Math.min(m.confirmedCommission, perf.totalCommission);
    const rejected = Math.min(
      m.rejectedCommission,
      Math.max(0, perf.totalCommission - confirmed),
    );
    const pending = Math.max(0, perf.totalCommission - confirmed - rejected);

    return {
      ...m,
      orderCount: perf.orderCount,
      totalCommission: perf.totalCommission,
      confirmedCommission: confirmed,
      pendingCommission: pending,
      rejectedCommission: rejected,
      rejectionRate:
        perf.totalCommission > 0 ? (rejected / perf.totalCommission) * 100 : 0,
    };
  });

  const existingKeys = new Set(
    result
      .filter((m) => m.platformCode === 'rewardoo')
      .map((m) => rwMerchantAggKey(m.merchantId, m.channelDisplayName ?? '', m.affiliateAlias)),
  );

  for (const [key, perf] of perfByKey) {
    if (existingKeys.has(key)) continue;
    result.push({
      merchantId: perf.merchantId,
      merchantName: perf.merchantName,
      platformCode: 'rewardoo',
      platformName: perf.platformName,
      affiliateAlias: perf.affiliateAlias,
      channelDisplayName: perf.displayName,
      orderCount: perf.orderCount,
      rejectedOrderCount: 0,
      totalCommission: perf.totalCommission,
      confirmedCommission: 0,
      pendingCommission: perf.totalCommission,
      rejectedCommission: 0,
      rejectionRate: 0,
    });
  }

  return result;
}
