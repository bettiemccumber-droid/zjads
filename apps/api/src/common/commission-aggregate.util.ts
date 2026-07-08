import { NormalizedStatus } from '@prisma/client';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { commissionAlertMerchantId } from './commission-alert-key.util';
import { dedupeAffiliateOrderRecord } from './order-dedupe.util';
import {
  orderHasRejectedCommission,
  resolveOrderCommissionBuckets,
} from './order-commission-buckets.util';

/** 商家+平台维度佣金聚合行 */
export interface MerchantCommissionAgg {
  merchantId: string;
  merchantName: string;
  platformCode: string;
  platformName: string;
  affiliateAlias: string;
  orderCount: number;
  rejectedOrderCount: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
}

/** 分平台监控/结算汇总 */
export interface PlatformCommissionSummary {
  platformCode: string;
  platformName: string;
  collectorImplemented: boolean;
  channelAccountCount: number;
  channelAliases: string[];
  orderCount: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  rejectionRate: number;
  atRiskMerchantCount: number;
}

type OrderRow = {
  channelAccountId: number;
  externalOrderId: string;
  merchantId: string | null;
  merchantName: string | null;
  commission: unknown;
  normalizedStatus: NormalizedStatus;
  rawPayload?: unknown;
  channelAccount: {
    affiliateAlias: string | null;
    platform: { code: string; name: string };
  };
};

/**
 * 联盟订单按商家+平台+渠道去重聚合
 */
export function aggregateAffiliateOrders(orders: OrderRow[]): MerchantCommissionAgg[] {
  const map = new Map<string, MerchantCommissionAgg>();
  const orderAgg = new Map<
    string,
    {
      merchantKey: string;
      merchantId: string;
      merchantName: string;
      platformCode: string;
      platformName: string;
      alias: string;
      totalCommission: number;
      confirmedCommission: number;
      pendingCommission: number;
      rejectedCommission: number;
      hasRejected: boolean;
    }
  >();

  for (const o of orders) {
    const mid = o.merchantId ?? '';
    if (!mid) continue;

    const platformCode = o.channelAccount.platform.code;
    const alias = (o.channelAccount.affiliateAlias || '').toLowerCase();
    const dedupeKey = `${o.channelAccountId}|${dedupeAffiliateOrderRecord(o)}`;
    const merchantKey = `${mid}|${platformCode}|${alias}`;
    const comm = Number(o.commission);
    const buckets = resolveOrderCommissionBuckets(o);

    const existing = orderAgg.get(dedupeKey);
    if (existing) {
      existing.totalCommission += comm;
      existing.confirmedCommission += buckets.approved;
      existing.pendingCommission += buckets.pending;
      existing.rejectedCommission += buckets.rejected;
      if (orderHasRejectedCommission(o)) existing.hasRejected = true;
      if (!existing.merchantName && o.merchantName) existing.merchantName = o.merchantName;
      continue;
    }

    orderAgg.set(dedupeKey, {
      merchantKey,
      merchantId: mid,
      merchantName: o.merchantName ?? '',
      platformCode,
      platformName: o.channelAccount.platform.name,
      alias,
      totalCommission: comm,
      confirmedCommission: buckets.approved,
      pendingCommission: buckets.pending,
      rejectedCommission: buckets.rejected,
      hasRejected: orderHasRejectedCommission(o),
    });
  }

  for (const agg of orderAgg.values()) {
    if (!map.has(agg.merchantKey)) {
      map.set(agg.merchantKey, {
        merchantId: agg.merchantId,
        merchantName: agg.merchantName,
        platformCode: agg.platformCode,
        platformName: agg.platformName,
        affiliateAlias: agg.alias,
        orderCount: 0,
        rejectedOrderCount: 0,
        totalCommission: 0,
        confirmedCommission: 0,
        pendingCommission: 0,
        rejectedCommission: 0,
        rejectionRate: 0,
      });
    }
    const row = map.get(agg.merchantKey)!;
    row.orderCount += 1;
    row.totalCommission += agg.totalCommission;
    row.confirmedCommission += agg.confirmedCommission;
    row.pendingCommission += agg.pendingCommission;
    row.rejectedCommission += agg.rejectedCommission;
    if (agg.hasRejected) row.rejectedOrderCount += 1;
    if (!row.merchantName && agg.merchantName) row.merchantName = agg.merchantName;
  }

  return finalizeMerchantRows([...map.values()]);
}

/**
 * 监控/告警聚合：同一商家+平台合并全部渠道，且按平台内订单号去重（避免多账号重复计单）
 */
export function aggregateAffiliateOrdersForMonitor(orders: OrderRow[]): MerchantCommissionAgg[] {
  const map = new Map<string, MerchantCommissionAgg>();
  const orderAgg = new Map<
    string,
    {
      aggKey: string;
      merchantId: string;
      merchantName: string;
      platformCode: string;
      platformName: string;
      alias: string;
      totalCommission: number;
      confirmedCommission: number;
      pendingCommission: number;
      rejectedCommission: number;
      hasRejected: boolean;
    }
  >();

  for (const o of orders) {
    const mid = o.merchantId ?? '';
    if (!mid) continue;

    const platformCode = o.channelAccount.platform.code;
    const alias = (o.channelAccount.affiliateAlias || '').toLowerCase();
    const dedupeKey = `${platformCode}|${dedupeAffiliateOrderRecord(o)}`;
    const aggKey = `${mid}|${platformCode}`;
    const comm = Number(o.commission);
    const buckets = resolveOrderCommissionBuckets(o);

    const existing = orderAgg.get(dedupeKey);
    if (existing) {
      existing.totalCommission += comm;
      existing.confirmedCommission += buckets.approved;
      existing.pendingCommission += buckets.pending;
      existing.rejectedCommission += buckets.rejected;
      if (orderHasRejectedCommission(o)) existing.hasRejected = true;
      if (!existing.merchantName && o.merchantName) existing.merchantName = o.merchantName;
      if (alias) existing.alias = mergeAliasList(existing.alias, alias);
      continue;
    }

    orderAgg.set(dedupeKey, {
      aggKey,
      merchantId: mid,
      merchantName: o.merchantName ?? '',
      platformCode,
      platformName: o.channelAccount.platform.name,
      alias,
      totalCommission: comm,
      confirmedCommission: buckets.approved,
      pendingCommission: buckets.pending,
      rejectedCommission: buckets.rejected,
      hasRejected: orderHasRejectedCommission(o),
    });
  }

  for (const agg of orderAgg.values()) {
    if (!map.has(agg.aggKey)) {
      map.set(agg.aggKey, {
        merchantId: agg.merchantId,
        merchantName: agg.merchantName,
        platformCode: agg.platformCode,
        platformName: agg.platformName,
        affiliateAlias: agg.alias,
        orderCount: 0,
        rejectedOrderCount: 0,
        totalCommission: 0,
        confirmedCommission: 0,
        pendingCommission: 0,
        rejectedCommission: 0,
        rejectionRate: 0,
      });
    }
    const row = map.get(agg.aggKey)!;
    row.orderCount += 1;
    row.totalCommission += agg.totalCommission;
    row.confirmedCommission += agg.confirmedCommission;
    row.pendingCommission += agg.pendingCommission;
    row.rejectedCommission += agg.rejectedCommission;
    if (agg.hasRejected) row.rejectedOrderCount += 1;
    if (!row.merchantName && agg.merchantName) row.merchantName = agg.merchantName;
    if (agg.alias) row.affiliateAlias = mergeAliasList(row.affiliateAlias, agg.alias);
  }

  return finalizeMerchantRows([...map.values()]);
}

function mergeAliasList(existing: string, alias: string): string {
  if (!existing) return alias;
  const parts = existing.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.includes(alias)) return existing;
  return [...parts, alias].join(', ');
}

function finalizeMerchantRows(rows: MerchantCommissionAgg[]): MerchantCommissionAgg[] {
  return rows.map((r) => ({
    ...r,
    totalCommission: round2(r.totalCommission),
    confirmedCommission: round2(r.confirmedCommission),
    pendingCommission: round2(r.pendingCommission),
    rejectedCommission: round2(r.rejectedCommission),
    rejectionRate:
      r.totalCommission > 0 ? round1((r.rejectedCommission / r.totalCommission) * 100) : 0,
  }));
}

/**
 * 按平台汇总商家聚合结果
 */
export function summarizeMerchantsByPlatform(
  merchants: MerchantCommissionAgg[],
  atRiskKeys: Set<string>,
): PlatformCommissionSummary[] {
  const map = new Map<string, PlatformCommissionSummary>();

  for (const m of merchants) {
    if (!map.has(m.platformCode)) {
      map.set(m.platformCode, {
        platformCode: m.platformCode,
        platformName: m.platformName,
        collectorImplemented: isCollectorImplemented(m.platformCode),
        channelAccountCount: 0,
        channelAliases: [],
        orderCount: 0,
        totalCommission: 0,
        confirmedCommission: 0,
        pendingCommission: 0,
        rejectedCommission: 0,
        rejectionRate: 0,
        atRiskMerchantCount: 0,
      });
    }
    const p = map.get(m.platformCode)!;
    p.orderCount += m.orderCount;
    p.totalCommission += m.totalCommission;
    p.confirmedCommission += m.confirmedCommission;
    p.pendingCommission += m.pendingCommission;
    p.rejectedCommission += m.rejectedCommission;

  }

  const riskByPlatform = new Map<string, Set<string>>();
  for (const m of merchants) {
    const riskKey = commissionAlertMerchantId(m.merchantId, m.platformCode, m.affiliateAlias);
    if (!atRiskKeys.has(riskKey)) continue;
    if (!riskByPlatform.has(m.platformCode)) riskByPlatform.set(m.platformCode, new Set());
    riskByPlatform.get(m.platformCode)!.add(riskKey);
  }

  for (const p of map.values()) {
    p.atRiskMerchantCount = riskByPlatform.get(p.platformCode)?.size ?? 0;
    p.totalCommission = round2(p.totalCommission);
    p.confirmedCommission = round2(p.confirmedCommission);
    p.pendingCommission = round2(p.pendingCommission);
    p.rejectedCommission = round2(p.rejectedCommission);
    p.rejectionRate =
      p.totalCommission > 0 ? round1((p.rejectedCommission / p.totalCommission) * 100) : 0;
  }

  return [...map.values()].sort((a, b) => b.rejectedCommission - a.rejectedCommission);
}

/**
 * 合并用户渠道账号：无订单的平台也展示（便于全平台巡检）
 */
export function mergePlatformCatalog(
  summaries: PlatformCommissionSummary[],
  accounts: Array<{
    affiliateAlias: string;
    displayName: string;
    platform: { code: string; name: string };
  }>,
): PlatformCommissionSummary[] {
  const map = new Map<string, PlatformCommissionSummary>();

  for (const a of accounts) {
    const code = a.platform.code;
    if (!map.has(code)) {
      map.set(code, {
        platformCode: code,
        platformName: a.platform.name,
        collectorImplemented: isCollectorImplemented(code),
        channelAccountCount: 0,
        channelAliases: [],
        orderCount: 0,
        totalCommission: 0,
        confirmedCommission: 0,
        pendingCommission: 0,
        rejectedCommission: 0,
        rejectionRate: 0,
        atRiskMerchantCount: 0,
      });
    }
    const p = map.get(code)!;
    p.channelAccountCount += 1;
    const alias = a.affiliateAlias || a.displayName;
    if (alias && !p.channelAliases.includes(alias)) p.channelAliases.push(alias);
  }

  for (const s of summaries) {
    const existing = map.get(s.platformCode);
    if (existing) {
      map.set(s.platformCode, {
        ...existing,
        ...s,
        channelAccountCount: existing.channelAccountCount,
        channelAliases: existing.channelAliases,
      });
    } else {
      map.set(s.platformCode, s);
    }
  }

  return [...map.values()].sort(
    (a, b) => a.platformName.localeCompare(b.platformName) || b.orderCount - a.orderCount,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
