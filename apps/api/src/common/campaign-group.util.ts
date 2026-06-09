/**
 * 广告系列综合展示：同一商家+联盟序号下多个 Google 子账号合并为一条逻辑系列
 */
export interface CampaignGroupKeyInput {
  campaignName: string;
  merchantId: string;
  affiliateAlias: string;
  customerId: string;
  campaignId: string;
}

/**
 * 解析广告系列合并键：优先 merchantId + affiliateAlias，其次系列名，最后 customer|campaign
 */
export function resolveCampaignGroupKey(input: CampaignGroupKeyInput): string {
  const mid = (input.merchantId || '').trim();
  const alias = (input.affiliateAlias || '').trim().toLowerCase();
  if (mid && alias) return `${alias}|${mid}`;

  const name = (input.campaignName || '').trim().toLowerCase();
  if (name) return `name:${name}`;

  const cid = (input.customerId || '').trim();
  const campId = (input.campaignId || '').trim();
  if (cid && campId) return `cid:${cid}|${campId}`;

  return `cid:${campId || 'unknown'}`;
}
