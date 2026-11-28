export interface ParsedCampaignName {
  affiliateAlias: string;
  merchantId: string;
  /** 系列名第三段，如 BODi */
  merchantSlug: string;
}

/**
 * 解析广告系列名：编号-联盟序号-商家名-国家-日期-商家ID
 * @example `596-pm1-Champion-US-0826-71017` → pm1 / 71017
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

/**
 * 联盟序号前缀 → 系统 platformCode（广告归属 / 账号兜底共用）
 */
export function platformCodeFromAlias(alias: string): string {
  const prefix = (alias || '').toLowerCase();
  if (prefix.startsWith('lh')) return 'linkhaitao';
  if (prefix.startsWith('pm')) return 'partnermatic';
  if (prefix.startsWith('lb')) return 'linkbux';
  if (prefix.startsWith('rw')) return 'rewardoo';
  if (prefix.startsWith('ui')) return 'ultrainfluence';
  if (prefix.startsWith('cg')) return 'collabglow';
  if (prefix.startsWith('fs')) return 'famesta';
  // bsh：广告系列实名（如 000-bsh5-…）；bsp：接入期备用前缀，仍映射到同一平台
  if (prefix.startsWith('bsh') || prefix.startsWith('bsp')) return 'brandsparkhub';
  return '';
}

/**
 * 从广告系列联盟序号推断平台名（用于商家汇总补全 platformName）
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
  if (a.startsWith('bsh') || a.startsWith('bsp')) return 'Brandsparkhub';
  return '';
}
