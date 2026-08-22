/**
 * 解析 CommissionAlert.merchantId 复合键
 * 格式：`{merchantId}|{platformCode}` 或 `{merchantId}|{platformCode}|{affiliateAlias}`
 */
export function parseCommissionAlertMerchantKey(merchantId: string): {
  merchantId: string;
  platformCode: string;
  affiliateAlias?: string;
} {
  const parts = merchantId.split('|');
  return {
    merchantId: parts[0] ?? '',
    platformCode: parts[1] ?? '',
    affiliateAlias: parts[2],
  };
}

/** 用于判断商家是否仍在投放的最小广告系列字段 */
export interface ActiveCampaignHint {
  merchantId: string;
  affiliateAlias: string;
  campaignName: string;
  campaignStatus?: string;
}

/**
 * 判断风险告警商家在当前活跃广告系列中是否仍在投放
 */
export function isAlertMerchantStillAdvertising(
  alertMerchantKey: string,
  activeCampaigns: ActiveCampaignHint[],
): ActiveCampaignHint[] {
  const parsed = parseCommissionAlertMerchantKey(alertMerchantKey);
  if (!parsed.merchantId) return [];

  return activeCampaigns.filter((c) => {
    if (c.merchantId !== parsed.merchantId) return false;
    if (
      parsed.affiliateAlias &&
      c.affiliateAlias.toLowerCase() !== parsed.affiliateAlias.toLowerCase()
    ) {
      return false;
    }
    return true;
  });
}
