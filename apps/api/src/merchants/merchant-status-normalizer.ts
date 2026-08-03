import {
  MerchantActionLabel,
  MerchantAvailability,
  MonetizationBrandRow,
  RelationshipStatus,
} from './merchant-status.types';

/**
 * 解析联盟 Monetization 返回的 relationship 字段
 */
export function normalizeRelationshipStatus(raw: string | null | undefined): RelationshipStatus {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, '');
  if (!v) return 'not_joined';
  if (v === 'joined' || v === 'approved' || v === 'active') return 'joined';
  if (v === 'pending' || v === 'waiting' || v === 'applying' || v === 'processing') return 'pending';
  if (v === 'rejected' || v === 'declined' || v === 'denied') return 'rejected';
  if (v === 'norelationship' || v === 'notjoined' || v === 'none') return 'not_joined';
  return 'unknown';
}

/**
 * 解析 brand_status / merchant_status
 */
export function normalizeMerchantAvailability(
  raw: string | null | undefined,
): MerchantAvailability {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!v) return 'unknown';
  if (v === 'online' || v === 'active' || v === 'enabled' || v === '1') return 'online';
  if (v === 'offline' || v === 'inactive' || v === 'disabled' || v === '0') return 'offline';
  return 'unknown';
}

/**
 * 根据关系 + 上架状态生成投前建议
 */
export function buildActionLabel(
  relationshipStatus: RelationshipStatus,
  merchantAvailability: MerchantAvailability,
  hasError: boolean,
): MerchantActionLabel {
  if (hasError) return '查询失败';
  if (relationshipStatus === 'not_found') return '无商家';
  if (relationshipStatus === 'pending') return '待审核';
  if (relationshipStatus === 'rejected') return '已拒绝';
  if (relationshipStatus === 'not_joined') return '未加入';
  if (relationshipStatus === 'unknown') return '状态未知';
  if (relationshipStatus === 'joined' && merchantAvailability === 'offline') return '商家已下架';
  if (relationshipStatus === 'joined' && merchantAvailability === 'online') return '可投';
  if (relationshipStatus === 'joined') return '状态未知';
  return '状态未知';
}

/**
 * 是否可投：已 Join 且仍 Online
 */
export function isMerchantActionable(
  relationshipStatus: RelationshipStatus,
  merchantAvailability: MerchantAvailability,
): boolean {
  return relationshipStatus === 'joined' && merchantAvailability === 'online';
}

/**
 * 从 Monetization 行构建标准化字段
 */
export function mapMonetizationBrandRow(row: MonetizationBrandRow): {
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  relationshipStatus: RelationshipStatus;
  relationshipRaw: string | null;
  merchantAvailability: MerchantAvailability;
  availabilityRaw: string | null;
} {
  const merchantId =
    row.brand_id != null && String(row.brand_id) !== '0'
      ? String(row.brand_id)
      : row.mid != null && String(row.mid) !== '0'
        ? String(row.mid)
        : row.m_id != null && /^\d+$/.test(String(row.m_id))
          ? String(row.m_id)
          : null;
  const relationshipRaw = row.relationship ?? row.join_status ?? null;
  const availabilityRaw = row.brand_status ?? row.merchant_status ?? null;
  const relationshipStatus = normalizeRelationshipStatus(relationshipRaw);
  const merchantAvailability = normalizeMerchantAvailability(availabilityRaw);

  const slugMcid =
    row.mcid ??
    (row.m_id != null && !/^\d+$/.test(String(row.m_id)) ? String(row.m_id) : null);

  return {
    merchantId,
    mcid: slugMcid ? String(slugMcid) : null,
    merchantName: row.merchant_name ?? row.sitename ?? null,
    siteUrl: row.site_url ? String(row.site_url) : null,
    relationshipStatus,
    relationshipRaw,
    merchantAvailability,
    availabilityRaw,
  };
}

/**
 * 判断 Monetization 行是否匹配查询项
 */
export function monetizationRowMatchesQuery(
  row: MonetizationBrandRow,
  query: { merchantId?: string; mcid?: string; domain?: string },
): boolean {
  const mapped = mapMonetizationBrandRow(row);
  const qMid = query.merchantId?.trim();
  const qMcid = query.mcid?.trim().toLowerCase();
  const qDomain = query.domain?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const rowMid = row.m_id != null ? String(row.m_id) : null;
  const rowSlug = rowMid?.toLowerCase();

  if (qMid && (mapped.merchantId === qMid || rowMid === qMid)) return true;
  if (qMcid && (mapped.mcid?.toLowerCase() === qMcid || rowSlug === qMcid)) return true;
  if (qDomain && mapped.siteUrl) {
    const site = mapped.siteUrl
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    if (site.includes(qDomain) || qDomain.includes(site)) return true;
  }
  return false;
}

/**
 * 解析批量粘贴 / 导入的 MID 文本
 */
export function parseMerchantQueryText(text: string): Array<{ merchantId?: string; mcid?: string }> {
  const items: Array<{ merchantId?: string; mcid?: string }> = [];
  const seen = new Set<string>();

  for (const line of text.split(/\r?\n/)) {
    for (const part of line.split(/[,，\t\s]+/)) {
      const token = part.trim();
      if (!token) continue;
      if (/^\d+$/.test(token)) {
        if (seen.has(`mid:${token}`)) continue;
        seen.add(`mid:${token}`);
        items.push({ merchantId: token });
        continue;
      }
      if (/^[a-z0-9][a-z0-9_-]{1,80}$/i.test(token)) {
        if (seen.has(`mcid:${token.toLowerCase()}`)) continue;
        seen.add(`mcid:${token.toLowerCase()}`);
        items.push({ mcid: token.toLowerCase() });
      }
    }
  }

  return items;
}
