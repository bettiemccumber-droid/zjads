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
  /** LinkHaitao Advertiser Status API：join_status 数字码 */
  if (v === '4') return 'joined';
  if (v === '2') return 'pending';
  if (v === '3') return 'rejected';
  if (v === '1') return 'not_joined';
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
 * 各平台官网字段名不一样，按常见名字取第一个网址。
 */
function firstSiteUrl(row: MonetizationBrandRow): string | null {
  const raw = row as MonetizationBrandRow & Record<string, unknown>;
  const keys = ['site_url', 'siteurl', 'website', 'site', 'url', 'brand_url', 'domain', 'advertiser_url'];
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
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
    siteUrl: firstSiteUrl(row),
    relationshipStatus,
    relationshipRaw,
    merchantAvailability,
    availabilityRaw,
  };
}

/**
 * 商家库一行里要用到的网址、佣金和地区。
 */
export function mapCatalogOffer(row: MonetizationBrandRow): {
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  relationshipStatus: RelationshipStatus;
  commRate: string;
  categories: string;
  countryCode: string;
  supportRegion: string;
  tags: string;
  logo: string;
} {
  const mapped = mapMonetizationBrandRow(row);
  const raw = row as MonetizationBrandRow & Record<string, unknown>;
  const commRate = catalogText_(raw.comm_rate);
  const categories = catalogText_(raw.categories);
  const country = catalogText_(raw.country);
  const region =
    catalogText_(raw.support_region) ||
    (Array.isArray(raw.post_area_list) ? raw.post_area_list.map((item) => catalogText_(item)).filter(Boolean).join(',') : catalogText_(raw.post_area_list));
  const countryCode = (country || region.split(/[,，/\s]+/)[0] || 'US').replace(/[^A-Za-z]/g, '').slice(0, 8).toUpperCase() || 'US';
  return {
    merchantId: mapped.merchantId,
    mcid: mapped.mcid,
    merchantName: mapped.merchantName,
    siteUrl: mapped.siteUrl,
    relationshipStatus: mapped.relationshipStatus,
    commRate,
    categories,
    countryCode,
    supportRegion: region || country,
    tags: catalogText_(raw.tags),
    logo: catalogText_(raw.logo) || catalogText_(raw.logo_url) || catalogText_(raw.brand_logo) || catalogText_(raw.merchant_logo),
  };
}

/**
 * 名称、MID、网址是否包含这次搜索。
 */
export function monetizationRowMatchesText(row: MonetizationBrandRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const offer = mapCatalogOffer(row);
  const haystack = [offer.merchantName, offer.merchantId, offer.mcid, offer.siteUrl, offer.categories, offer.commRate]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

function catalogText_(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
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

  const rowMid =
    row.mid != null
      ? String(row.mid)
      : row.m_id != null
        ? String(row.m_id)
        : null;
  const rowSlug = rowMid?.toLowerCase();
  const rowMcid = row.mcid?.toLowerCase();

  if (qMid && (mapped.merchantId === qMid || rowMid === qMid)) return true;
  if (qMcid && (mapped.mcid?.toLowerCase() === qMcid || rowSlug === qMcid || rowMcid === qMcid)) return true;
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
