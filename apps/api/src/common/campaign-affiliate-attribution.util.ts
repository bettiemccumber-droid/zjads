/**
 * 广告系列联盟归因：同商家跨 lh5/lh6 等序号时只计一次佣金
 */

/** 联盟侧指标切片（订单/佣金/点击） */
export interface AffiliateMetricsSlice {
  orderCount: number;
  commission: number;
  affiliateClicks: number;
}

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
 * 广告系列归因去重键：PM/RW/LH/LB 各平台族内按 merchantId 只计一次
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

/**
 * 按平台族汇总 byKey 中的联盟指标（不含 RW；RW 仍走 byMerchantId）
 */
export function aggregateAffiliateMetricsByFamily(
  byKey: ReadonlyMap<string, AffiliateMetricsSlice>,
  merchantId: string,
  familyPrefix: 'lh' | 'lb' | 'pm',
): AffiliateMetricsSlice {
  const result: AffiliateMetricsSlice = { orderCount: 0, commission: 0, affiliateClicks: 0 };
  for (const [key, metrics] of byKey) {
    const pipe = key.indexOf('|');
    if (pipe < 0) continue;
    const mid = key.slice(0, pipe);
    const alias = key.slice(pipe + 1).toLowerCase();
    if (mid !== merchantId || !alias.startsWith(familyPrefix)) continue;
    result.commission += metrics.commission;
    result.orderCount += metrics.orderCount;
    result.affiliateClicks += metrics.affiliateClicks;
  }
  return result;
}

/**
 * 按平台族汇总带日期的 byKey（键格式 merchantId|alias|YYYY-MM-DD）
 */
export function aggregateAffiliateMetricsByFamilyForDay(
  byKey: ReadonlyMap<string, AffiliateMetricsSlice>,
  merchantId: string,
  familyPrefix: 'lh' | 'lb' | 'pm',
  dateStr: string,
): AffiliateMetricsSlice {
  const suffix = `|${dateStr}`;
  const result: AffiliateMetricsSlice = { orderCount: 0, commission: 0, affiliateClicks: 0 };
  for (const [key, metrics] of byKey) {
    if (!key.endsWith(suffix)) continue;
    const body = key.slice(0, -suffix.length);
    const pipe = body.indexOf('|');
    if (pipe < 0) continue;
    const mid = body.slice(0, pipe);
    const alias = body.slice(pipe + 1).toLowerCase();
    if (mid !== merchantId || !alias.startsWith(familyPrefix)) continue;
    result.commission += metrics.commission;
    result.orderCount += metrics.orderCount;
    result.affiliateClicks += metrics.affiliateClicks;
  }
  return result;
}

/** Sheet 中是否已有系列可承接该商家的联盟归因（同平台族不限序号；含暂停后重开的新系列） */
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

/** 是否为「无 Sheet 系列」补行 */
export function isOrphanAffiliateCampaign(campaignId: string, campaignName: string): boolean {
  if ((campaignId || '').startsWith('orphan|')) return true;
  return (campaignName || '').includes('无 Sheet 系列');
}
