/**
 * 采集账号挑选：LH 同联盟序号多内容站挂号时，API 往往返回同一批佣金，
 * 同步只保留每个 alias 的主账号（id 最小），避免重复入库。
 */
export function pickAccountsForAffiliateSync<
  T extends {
    id: number;
    affiliateAlias?: string | null;
    platform: { code: string };
  },
>(accounts: T[]): T[] {
  const sorted = [...accounts].sort((a, b) => a.id - b.id);
  const seenLhAlias = new Set<string>();
  const out: T[] = [];
  for (const account of sorted) {
    if (account.platform.code === 'linkhaitao') {
      const alias = (account.affiliateAlias || '').trim().toLowerCase();
      const key = alias || `__id:${account.id}`;
      if (seenLhAlias.has(key)) continue;
      seenLhAlias.add(key);
    }
    out.push(account);
  }
  return out;
}
