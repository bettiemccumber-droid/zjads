/**
 * 联盟订单去重键：与 PM 报表「Orders」按订单号（oid）一致。
 * 兼容历史入库格式 `pm:{oid}:{行哈希}`（按商品行拆分时误计为多单）。
 * RW 订单数以 Performance API 写入的 performanceOrders 为准，此处不去重 RW 明细行。
 */
export function dedupeAffiliateOrderKey(externalOrderId: string): string {
  const id = externalOrderId.trim();
  if (!id.startsWith('pm:')) {
    return id;
  }
  const parts = id.split(':');
  if (parts.length >= 3 && /^[a-f0-9]{16,32}$/i.test(parts[parts.length - 1] ?? '')) {
    return parts.slice(0, -1).join(':');
  }
  return id;
}

/**
 * 从 Prisma 联盟订单记录解析去重键
 */
export function dedupeAffiliateOrderRecord(o: {
  externalOrderId: string;
  rawPayload?: unknown;
  channelAccount?: { platform?: { code?: string } };
}): string {
  return dedupeAffiliateOrderKey(o.externalOrderId);
}
