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

/**
 * 报表/佣金汇总用的订单去重键。
 * LinkHaitao：同 alias 多渠道账号可能入库同一批单，跨 channelAccount 按平台+单号去重。
 * 其它平台：仍按渠道账号隔离（PM 同行拆分后同账号内可合并加总）。
 */
export function affiliateOrderMetricsDedupeKey(o: {
  channelAccountId: number;
  externalOrderId: string;
  rawPayload?: unknown;
  channelAccount?: { platform?: { code?: string } };
}): string {
  const platformCode = o.channelAccount?.platform?.code || '';
  const orderId = dedupeAffiliateOrderRecord(o);
  if (platformCode === 'linkhaitao') {
    return `linkhaitao|${orderId}`;
  }
  return `${o.channelAccountId}|${orderId}`;
}

/** LH 跨账号撞到同一单号时不再累加佣金（取先到的一份） */
export function shouldAccumulateCommissionOnDedupeHit(platformCode: string): boolean {
  return platformCode !== 'linkhaitao';
}
