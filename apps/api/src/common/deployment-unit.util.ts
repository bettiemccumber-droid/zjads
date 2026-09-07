import {
  ChannelAccountCommissionSummary,
  MerchantCommissionAgg,
  finalizeMerchantRows,
} from './commission-aggregate.util';
import { isCollectorImplemented } from '../collectors/collectors.registry';

/** 投放单元：platform + displayName + affiliateAlias（同单元多 Channel 合并展示/结算） */
export function deploymentUnitKey(
  platformCode: string,
  displayName: string,
  affiliateAlias: string,
): string {
  return `${platformCode}|${(displayName || '').trim().toLowerCase()}|${(affiliateAlias || '').trim().toLowerCase()}`;
}

export function deploymentUnitKeyForAccount(account: {
  displayName: string;
  affiliateAlias: string;
  platform: { code: string };
}): string {
  return deploymentUnitKey(account.platform.code, account.displayName, account.affiliateAlias);
}

export function deploymentUnitKeyForMerchant(m: MerchantCommissionAgg): string {
  return deploymentUnitKey(m.platformCode, m.channelDisplayName ?? '', m.affiliateAlias);
}

type ChannelAccountRef = {
  id: number;
  affiliateAlias: string;
  displayName: string;
  platform: { code: string; name: string };
};

/**
 * 筛选与指定 channelAccountId 同属一个投放单元的绑定
 */
export function filterAccountsByDeploymentUnit<T extends ChannelAccountRef>(
  accounts: T[],
  channelAccountId?: number,
): T[] {
  if (!channelAccountId) return accounts;
  const target = accounts.find((a) => a.id === channelAccountId);
  if (!target) return [];
  const key = deploymentUnitKeyForAccount(target);
  return accounts.filter((a) => deploymentUnitKeyForAccount(a) === key);
}

/**
 * 将按 Channel 拆分的商家聚合行合并为投放单元维度（同商家+同单元只保留一行）
 */
export function rollupMerchantsByDeploymentUnit(
  merchants: MerchantCommissionAgg[],
  accountById: Map<number, ChannelAccountRef>,
): MerchantCommissionAgg[] {
  const map = new Map<string, MerchantCommissionAgg>();

  for (const m of merchants) {
    const account = m.channelAccountId != null ? accountById.get(m.channelAccountId) : undefined;
    const displayName = account?.displayName ?? m.channelDisplayName ?? '';
    const unitKey = deploymentUnitKey(m.platformCode, displayName, m.affiliateAlias);
    const merchantKey = `${m.merchantId}|${unitKey}`;

    const existing = map.get(merchantKey);
    if (!existing) {
      map.set(merchantKey, {
        ...m,
        channelAccountId: undefined,
        channelDisplayName: displayName,
      });
      continue;
    }

    existing.orderCount += m.orderCount;
    existing.rejectedOrderCount += m.rejectedOrderCount;
    existing.totalCommission += m.totalCommission;
    existing.confirmedCommission += m.confirmedCommission;
    existing.pendingCommission += m.pendingCommission;
    existing.rejectedCommission += m.rejectedCommission;
    if (!existing.merchantName && m.merchantName) existing.merchantName = m.merchantName;
  }

  return finalizeMerchantRows([...map.values()]);
}

/**
 * 按投放单元汇总（含无订单单元；channelAccountId 取组内最小 id 供筛选兼容）
 */
export function summarizeMerchantsByDeploymentUnit(
  merchants: MerchantCommissionAgg[],
  accounts: ChannelAccountRef[],
): ChannelAccountCommissionSummary[] {
  const unitMap = new Map<string, ChannelAccountRef[]>();

  for (const a of accounts) {
    const key = deploymentUnitKeyForAccount(a);
    if (!unitMap.has(key)) unitMap.set(key, []);
    unitMap.get(key)!.push(a);
  }

  const summaries = new Map<string, ChannelAccountCommissionSummary>();

  for (const [unitKey, accs] of unitMap) {
    const ids = accs.map((a) => a.id).sort((x, y) => x - y);
    const first = accs[0];
    summaries.set(unitKey, {
      deploymentUnitKey: unitKey,
      channelAccountId: ids[0]!,
      channelAccountIds: ids,
      channelCount: ids.length,
      displayName: first.displayName,
      affiliateAlias: first.affiliateAlias,
      platformCode: first.platform.code,
      platformName: first.platform.name,
      collectorImplemented: isCollectorImplemented(first.platform.code),
      orderCount: 0,
      totalCommission: 0,
      confirmedCommission: 0,
      pendingCommission: 0,
      rejectedCommission: 0,
      rejectionRate: 0,
    });
  }

  for (const m of merchants) {
    const unitKey = deploymentUnitKeyForMerchant(m);
    const row = summaries.get(unitKey);
    if (!row) continue;
    row.orderCount += m.orderCount;
    row.totalCommission += m.totalCommission;
    row.confirmedCommission += m.confirmedCommission;
    row.pendingCommission += m.pendingCommission;
    row.rejectedCommission += m.rejectedCommission;
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const round1 = (n: number) => Math.round(n * 10) / 10;

  for (const row of summaries.values()) {
    row.totalCommission = round2(row.totalCommission);
    row.confirmedCommission = round2(row.confirmedCommission);
    row.pendingCommission = round2(row.pendingCommission);
    row.rejectedCommission = round2(row.rejectedCommission);
    row.rejectionRate =
      row.totalCommission > 0 ? round1((row.rejectedCommission / row.totalCommission) * 100) : 0;
  }

  return [...summaries.values()].sort(
    (a, b) =>
      a.platformName.localeCompare(b.platformName) ||
      a.displayName.localeCompare(b.displayName) ||
      b.orderCount - a.orderCount,
  );
}
