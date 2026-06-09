/**
 * 联盟订单去重键：与 PM 报表「Orders」按订单号（oid）一致。
 * 兼容历史入库格式 `pm:{oid}:{行哈希}`（按商品行拆分时误计为多单）。
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
