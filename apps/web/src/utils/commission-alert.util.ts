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

/** 横幅告警行（与 API 返回一致的最小字段） */
export interface BannerAlertRow {
  id: number;
  merchantId: string;
  merchantName: string;
  rejectedCommission: number;
  rejectionRate: number;
  rejectedOrderCount: number;
  totalOrderCount: number;
  severity: string;
  windowStart: string;
  windowEnd: string;
}

/** 按商家合并后的横幅条目 */
export interface GroupedMerchantAlert {
  merchantKey: string;
  merchantName: string;
  parsed: ReturnType<typeof parseCommissionAlertMerchantKey>;
  alerts: BannerAlertRow[];
  severity: 'critical' | 'warning';
  rejectedCommission: number;
  rejectionRate: number;
  rejectedOrderCount: number;
  totalOrderCount: number;
  windowCount: number;
  stillActive: ActiveCampaignHint[];
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

function severityRank(severity: string) {
  return severity === 'critical' ? 0 : 1;
}

/**
 * 将 open 告警按商家（merchantId 复合键）合并，取最严重指标用于排序与展示
 */
export function groupOpenAlertsByMerchant(
  alerts: BannerAlertRow[],
  activeCampaigns: ActiveCampaignHint[],
): GroupedMerchantAlert[] {
  const map = new Map<string, BannerAlertRow[]>();
  for (const alert of alerts) {
    const list = map.get(alert.merchantId) ?? [];
    list.push(alert);
    map.set(alert.merchantId, list);
  }

  const groups: GroupedMerchantAlert[] = [];
  for (const [merchantKey, rows] of map) {
    const parsed = parseCommissionAlertMerchantKey(merchantKey);
    const severity = rows.some((r) => r.severity === 'critical') ? 'critical' : 'warning';
    const rejectedCommission = Math.max(...rows.map((r) => Number(r.rejectedCommission)));
    const rejectionRate = Math.max(...rows.map((r) => Number(r.rejectionRate)));
    const rejectedOrderCount = Math.max(...rows.map((r) => r.rejectedOrderCount));
    const totalOrderCount = Math.max(...rows.map((r) => r.totalOrderCount));
    const merchantName = rows.find((r) => r.merchantName)?.merchantName ?? parsed.merchantId;

    groups.push({
      merchantKey,
      merchantName,
      parsed,
      alerts: rows.sort((a, b) => b.windowEnd.localeCompare(a.windowEnd)),
      severity,
      rejectedCommission,
      rejectionRate,
      rejectedOrderCount,
      totalOrderCount,
      windowCount: rows.length,
      stillActive: isAlertMerchantStillAdvertising(merchantKey, activeCampaigns),
    });
  }

  groups.sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      b.rejectedCommission - a.rejectedCommission ||
      b.rejectionRate - a.rejectionRate,
  );

  return groups;
}
