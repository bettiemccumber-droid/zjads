/** 投放单元：platform + displayName + affiliateAlias */
export function deploymentUnitKey(
  platformCode: string,
  displayName: string,
  affiliateAlias: string,
): string {
  return `${platformCode}|${(displayName || '').trim().toLowerCase()}|${(affiliateAlias || '').trim().toLowerCase()}`;
}

export interface DeploymentUnitPick {
  platformCode: string;
  displayName: string;
  affiliateAlias: string;
}

export function deploymentUnitKeyForPick(account: DeploymentUnitPick): string {
  return deploymentUnitKey(account.platformCode, account.displayName, account.affiliateAlias);
}

export function groupAccountsByDeploymentUnit<T extends DeploymentUnitPick & { id: number }>(
  accounts: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const account of accounts) {
    const key = deploymentUnitKeyForPick(account);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(account);
  }
  return map;
}

export function accountIdsForDeploymentUnitFilter<T extends DeploymentUnitPick & { id: number }>(
  accounts: T[],
  channelAccountId: number,
): number[] {
  const target = accounts.find((a) => a.id === channelAccountId);
  if (!target) return [];
  const key = deploymentUnitKeyForPick(target);
  return accounts.filter((a) => deploymentUnitKeyForPick(a) === key).map((a) => a.id);
}

/** 选中 id 按投放单元补全（避免只选部分 Channel 导致状态不一致） */
export function normalizeSelectedSyncIds<T extends DeploymentUnitPick & { id: number }>(
  selectedIds: number[],
  accounts: T[],
): number[] {
  const grouped = groupAccountsByDeploymentUnit(accounts);
  const result = new Set<number>();
  for (const members of grouped.values()) {
    const ids = members.map((m) => m.id);
    if (ids.some((id) => selectedIds.includes(id))) {
      for (const id of ids) result.add(id);
    }
  }
  return [...result];
}

/** 已选中的投放单元数量（用于按钮文案） */
export function countSelectedDeploymentUnits<T extends DeploymentUnitPick & { id: number }>(
  selectedIds: number[],
  accounts: T[],
): number {
  const grouped = groupAccountsByDeploymentUnit(accounts);
  let count = 0;
  for (const members of grouped.values()) {
    const ids = members.map((m) => m.id);
    if (ids.every((id) => selectedIds.includes(id))) count += 1;
  }
  return count;
}
