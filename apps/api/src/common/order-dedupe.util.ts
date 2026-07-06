/** 联盟订单去重上下文（RW 需从 rawPayload 取 order_id） */
export interface AffiliateOrderDedupeContext {
  rawPayload?: unknown;
  platformCode?: string;
}

/**
 * 联盟订单去重键：与 PM/RW 报表「Orders」按订单号一致。
 * - PM：兼容历史 `pm:{oid}:{行哈希}`（按商品行拆分时误计为多单）
 * - RW：同一 order_id 多 sign_id 行合并为一单（与 Performance 看板 Orders 一致）
 */
export function dedupeAffiliateOrderKey(
  externalOrderId: string,
  ctx?: AffiliateOrderDedupeContext,
): string {
  const id = externalOrderId.trim();

  if (ctx?.platformCode === 'rewardoo') {
    const parentOrderId = extractRwParentOrderId(ctx.rawPayload);
    if (parentOrderId) return `rw:${parentOrderId}`;
  }

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
  return dedupeAffiliateOrderKey(o.externalOrderId, {
    rawPayload: o.rawPayload,
    platformCode: o.channelAccount?.platform?.code,
  });
}

/**
 * 从 RW transaction_details rawPayload 提取父订单号（Performance Orders 口径）
 */
function extractRwParentOrderId(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const row = rawPayload as Record<string, unknown>;
  for (const key of ['order_id', 'rewardoo_id'] as const) {
    const v = row[key];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}
