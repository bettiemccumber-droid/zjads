export interface ParsedCampaignName {
  affiliateAlias: string;
  merchantId: string;
}

/**
 * 解析广告系列名：编号-联盟序号-商家名-国家-日期-商家ID
 * @example `596-pm1-Champion-US-0826-71017` → pm1 / 71017
 */
export function parseCampaignName(name: string): ParsedCampaignName {
  const parts = name.split('-').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { affiliateAlias: '', merchantId: '' };
  }

  const affiliateAlias = parts[1].toLowerCase();
  let merchantId = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const segment = parts[i];
    if (/^\d{4,}$/.test(segment)) {
      merchantId = segment;
      break;
    }
  }

  return { affiliateAlias, merchantId };
}

/**
 * 从广告系列联盟序号推断平台名（用于商家汇总补全 platformName）
 */
export function inferPlatformNameFromAlias(alias: string): string {
  const a = (alias || '').toLowerCase();
  if (a.startsWith('lh')) return 'LinkHaitao';
  if (a.startsWith('pm')) return 'PartnerMatic';
  if (a.startsWith('lb')) return 'LinkBux';
  return '';
}
