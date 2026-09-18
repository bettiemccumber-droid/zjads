export interface ParsedCampaignName {
  affiliateAlias: string;
  merchantId: string;
  merchantSlug: string;
}

/**
 * 解析广告系列名：编号-联盟序号-商家名-国家-日期-商家ID
 * @example `126-fs5-Splits59-us-0915-8011738` → fs5 / 8011738
 */
export function parseCampaignName(name: string): ParsedCampaignName {
  const parts = name.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { affiliateAlias: '', merchantId: '', merchantSlug: '' };
  }

  const affiliateAlias = parts[1].toLowerCase();
  const merchantSlug = parts.length >= 3 ? parts[2].toLowerCase() : '';
  let merchantId = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const segment = parts[i];
    if (/^\d{4,}$/.test(segment)) {
      merchantId = segment;
      break;
    }
  }

  return { affiliateAlias, merchantId, merchantSlug };
}

/** 广告系列分析平台筛选项（与已接入采集器一致，按展示名排序） */
export const CAMPAIGN_PLATFORM_FILTER_NAMES = [
  'CollabGlow',
  'Famesta',
  'LinkBux',
  'LinkHaitao',
  'PartnerMatic',
  'Rewardoo',
  'UltraInfluence',
] as const;

/**
 * 从广告系列联盟序号推断平台名（与后端 campaign-name.util 一致）
 */
export function inferPlatformNameFromAlias(alias: string): string {
  const a = (alias || '').toLowerCase();
  if (a.startsWith('lh')) return 'LinkHaitao';
  if (a.startsWith('pm')) return 'PartnerMatic';
  if (a.startsWith('lb')) return 'LinkBux';
  if (a.startsWith('rw')) return 'Rewardoo';
  if (a.startsWith('ui')) return 'UltraInfluence';
  if (a.startsWith('cg')) return 'CollabGlow';
  if (a.startsWith('fs')) return 'Famesta';
  return '';
}

/**
 * 从广告系列行推断平台（优先 affiliateAlias，否则从系列名第二段解析）
 */
export function inferPlatformNameForCampaignRow(
  affiliateAlias: string,
  campaignName?: string,
): string {
  const fromField = inferPlatformNameFromAlias(affiliateAlias);
  if (fromField) return fromField;
  const parsed = parseCampaignName(campaignName ?? '');
  return inferPlatformNameFromAlias(parsed.affiliateAlias);
}
