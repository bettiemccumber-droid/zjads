/**
 * 佣金告警商家主键：与 CommissionAlert.merchantId 一致
 */
export function commissionAlertMerchantId(merchantId: string, platformCode: string): string {
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
