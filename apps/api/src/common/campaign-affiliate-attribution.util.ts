/**
 * 广告系列联盟归因：同商家跨 lh5/lh6 等序号时只计一次佣金
 */

/** 两联盟序号是否同属一个平台族（PM/LH/LB/RW） */
export function affiliateAliasSamePlatformFamily(a: string, b: string): boolean {
  const left = (a || '').toLowerCase();
  const right = (b || '').toLowerCase();
  if (left.startsWith('lh') && right.startsWith('lh')) return true;
  if (left.startsWith('lb') && right.startsWith('lb')) return true;
  if (left.startsWith('pm') && right.startsWith('pm')) return true;
  if (left.startsWith('rw') && right.startsWith('rw')) return true;
  return left === right;
}

/**
 * 广告系列归因去重键：PM/RW/LH/LB 按 merchantId；其余按 merchantId+alias
 */
export function campaignAffiliateAttributionKey(merchantId: string, alias: string): string {
  if (!merchantId) return '';
  const a = (alias || '').toLowerCase();
  if (a.startsWith('pm')) return `pm:${merchantId}`;
  if (a.startsWith('rw')) return `rw:${merchantId}`;
  if (a.startsWith('lh')) return `lh:${merchantId}`;
  if (a.startsWith('lb')) return `lb:${merchantId}`;
  return `${merchantId}|${a}`;
}

/** Sheet 中是否已有系列可承接该商家的联盟归因（LH/LB 不限序号） */
export function campaignCoversMerchantAffiliate(
  campaigns: ReadonlyArray<{ merchantId: string; affiliateAlias: string }>,
  merchantId: string,
  alias: string,
): boolean {
  return campaigns.some(
    (r) =>
      r.merchantId === merchantId &&
      affiliateAliasSamePlatformFamily(alias, r.affiliateAlias),
  );
}
