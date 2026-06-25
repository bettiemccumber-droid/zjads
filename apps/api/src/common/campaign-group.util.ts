export interface CampaignGroupKeyInput {
  campaignName: string;
  merchantId: string;
  affiliateAlias: string;
  customerId: string;
  campaignId: string;
}

/**
 * 逻辑系列键：同一广告系列名合并为一行（换 Google 子账号后仍视为同一广告）。
 * 无系列名时回退 联盟序号|商家ID 或 cid|campaignId。
 */
export function resolveCampaignGroupKey(input: CampaignGroupKeyInput): string {
  const campId = (input.campaignId || '').trim();

  if (campId.startsWith('orphan|')) {
    const mid = (input.merchantId || '').trim();
    const alias = (input.affiliateAlias || '').trim().toLowerCase();
    if (mid && alias) return `${alias}|${mid}`;
    return campId;
  }

  const name = (input.campaignName || '').trim().toLowerCase();
  if (name && !name.includes('无 sheet')) {
    return `name:${name}`;
  }

  const cid = (input.customerId || '').trim();
  if (cid && campId) {
    return `cid:${cid}|${campId}`;
  }

  const mid = (input.merchantId || '').trim();
  const alias = (input.affiliateAlias || '').trim().toLowerCase();
  if (mid && alias) return `${alias}|${mid}`;

  if (campId) return `cid:${cid || 'unknown'}|${campId}`;

  return `cid:unknown|${campId || 'unknown'}`;
}
