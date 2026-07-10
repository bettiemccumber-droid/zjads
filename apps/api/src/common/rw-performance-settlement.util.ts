import { isRwClickPseudoMerchant } from '../collectors/rewardoo-clicks';
import { MerchantCommissionAgg } from './commission-aggregate.util';

/** RW 商家聚合键：merchantId|rewardoo|渠道别名 */
export function rwMerchantAggKey(merchantId: string, affiliateAlias: string): string {
  return `${merchantId}|rewardoo|${affiliateAlias.toLowerCase()}`;
}

export interface RwPerformanceMerchantTotals {
  merchantId: string;
  merchantName: string;
  affiliateAlias: string;
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
    platform: { code: string; name: string } | null;
  };
}

/**
 * 按商家汇总 RW Performance 逐日指标（Transaction Date 口径，与联盟后台 Channel 报表一致）
 */
export function aggregateRwPerformanceByMerchant(
  rows: RwClickDailyPerformanceRow[],
): Map<string, RwPerformanceMerchantTotals> {
  const map = new Map<string, RwPerformanceMerchantTotals>();

  for (const c of rows) {
    if (c.channelAccount.platform?.code !== 'rewardoo') continue;
    if (isRwClickPseudoMerchant(c.merchantId)) continue;

    const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
    const key = rwMerchantAggKey(c.merchantId, alias);
    const prev = map.get(key) ?? {
      merchantId: c.merchantId,
      merchantName: c.merchantName ?? '',
      affiliateAlias: alias,
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
 * 将 RW 商家总佣金/订单数对齐为 Performance 逐日汇总（与数据采集看板一致）
 */
export function applyRwPerformanceCommissionOverlay(
  merchants: MerchantCommissionAgg[],
  perfByKey: Map<string, RwPerformanceMerchantTotals>,
): MerchantCommissionAgg[] {
  if (perfByKey.size === 0) return merchants;

  const result = merchants.map((m) => {
    if (m.platformCode !== 'rewardoo') return m;

    const key = `${m.merchantId}|${m.platformCode}|${m.affiliateAlias}`;
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
    result.map((m) => `${m.merchantId}|${m.platformCode}|${m.affiliateAlias}`),
  );

  for (const [key, perf] of perfByKey) {
    if (existingKeys.has(key)) continue;
    result.push({
      merchantId: perf.merchantId,
      merchantName: perf.merchantName,
      platformCode: 'rewardoo',
      platformName: perf.platformName,
      affiliateAlias: perf.affiliateAlias,
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
