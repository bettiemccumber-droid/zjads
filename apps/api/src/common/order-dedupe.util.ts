/**
 * 联盟订单去重键：与 PM 报表「Orders」按订单号（oid）一致。
 * 兼容历史入库格式 `pm:{oid}:{行哈希}`（按商品行拆分时误计为多单）。
 * RW：与 affiliate 一致，按 rawPayload.order_id / rewardoo_id 合并拆单商品行。
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
 * 从 RW 明细 rawPayload 提取父订单号（affiliate orderMap 口径）
 */
function extractRwParentOrderId(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const row = rawPayload as Record<string, unknown>;
  for (const key of ['order_id', 'rewardoo_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim() !== '' && String(v) !== '0') {
      return String(v).trim();
    }
  }
  return null;
}

/**
 * 从 Prisma 联盟订单记录解析去重键
 */
export function dedupeAffiliateOrderRecord(o: {
  externalOrderId: string;
  rawPayload?: unknown;
  channelAccount?: { platform?: { code?: string } };
}): string {
  if (o.channelAccount?.platform?.code === 'rewardoo') {
    const parentOrderId = extractRwParentOrderId(o.rawPayload);
    if (parentOrderId) return parentOrderId;
  }
  return dedupeAffiliateOrderKey(o.externalOrderId);
}
