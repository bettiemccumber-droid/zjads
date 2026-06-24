export interface CampaignGroupKeyInput {
  campaignName: string;
  merchantId: string;
  affiliateAlias: string;
  customerId: string;
  campaignId: string;
}

/**
 * 解析广告系列展示键，与 Google MCC「按广告系列」视图对齐。
 * 优先 `子账号 + campaignId`（换号、复用子账号各系列各占一行）；
 * 无 Google 键时回退 `联盟序号|商家ID`（联盟补行等）。
 */
export function resolveCampaignGroupKey(input: CampaignGroupKeyInput): string {
  const cid = (input.customerId || '').trim();
  const campId = (input.campaignId || '').trim();
  if (cid && campId && !campId.startsWith('orphan|')) {
    return `cid:${cid}|${campId}`;
  }

  const mid = (input.merchantId || '').trim();
  const alias = (input.affiliateAlias || '').trim().toLowerCase();
  if (mid && alias) return `${alias}|${mid}`;

  const name = (input.campaignName || '').trim().toLowerCase();
  if (name) return `name:${name}`;

  if (campId) return `cid:${cid || 'unknown'}|${campId}`;

  return `cid:unknown|${campId || 'unknown'}`;
}
