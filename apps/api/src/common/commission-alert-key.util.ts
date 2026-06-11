/**
 * 佣金告警商家主键：与 CommissionAlert.merchantId 一致
 * 含 affiliateAlias 时与结算表「商家+平台+渠道」口径一致
 */
export function commissionAlertMerchantId(
  merchantId: string,
  platformCode: string,
  affiliateAlias?: string,
): string {
  const alias = (affiliateAlias ?? '').trim().toLowerCase();
  if (alias) return `${merchantId}|${platformCode}|${alias}`;
  return `${merchantId}|${platformCode}`;
}

/**
 * Prisma 条件：仅匹配指定平台的告警记录（merchantId 格式为 `{id}|{platformCode}`）
 */
export function platformCommissionAlertFilter(platformCode: string) {
  const suffix = `|${platformCode}`;
  return {
    merchantId: {
      endsWith: suffix,
      not: { contains: `${suffix}|` },
    },
  };
}
