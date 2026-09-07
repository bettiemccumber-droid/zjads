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
