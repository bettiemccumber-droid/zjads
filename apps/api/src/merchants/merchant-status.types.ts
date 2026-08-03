/** 我的账号与商家的关系状态 */
export type RelationshipStatus =
  | 'joined'
  | 'pending'
  | 'rejected'
  | 'not_joined'
  /** 该平台 API 中查无此商家（如跨平台 MID 不互通） */
  | 'not_found'
  | 'unknown';

/** 商家在平台的上架状态 */
export type MerchantAvailability = 'online' | 'offline' | 'unknown';

/** 投前综合建议 */
export type MerchantActionLabel =
  | '可投'
  | '待审核'
  | '未加入'
  | '没有'
  | '已拒绝'
  | '商家已下架'
  | '状态未知'
  | '查询失败';

export interface MerchantQueryItem {
  merchantId?: string;
  mcid?: string;
  domain?: string;
}

export interface MerchantStatusRow {
  queryKey: string;
  merchantId: string | null;
  mcid: string | null;
  merchantName: string | null;
  siteUrl: string | null;
  platformCode: string;
  platformName: string;
  channelAccountId: number;
  channelDisplayName: string;
  affiliateAlias: string;
  ownerUserId: number;
  ownerUsername: string;
  relationshipStatus: RelationshipStatus;
  relationshipRaw: string | null;
  merchantAvailability: MerchantAvailability;
  availabilityRaw: string | null;
  actionable: boolean;
  actionLabel: MerchantActionLabel;
  queriedAt: string;
  error: string | null;
}

export interface MerchantStatusSummaryCounts {
  total: number;
  actionable: number;
  pending: number;
  rejected: number;
  notJoined: number;
  /** 该平台查无此商家 */
  notFound: number;
  offline: number;
  unknown: number;
  failed: number;
}

export interface MerchantStatusQueryResult {
  items: MerchantStatusRow[];
  summary: MerchantStatusSummaryCounts;
}

export interface PlatformPassSummary {
  platformCode: string;
  platformName: string;
  passed: number;
  pending: number;
  notPassed: number;
  failed: number;
}

export interface UserMerchantPassSummary {
  userId: number;
  username: string;
  byPlatform: PlatformPassSummary[];
  totalPassed: number;
}

export interface MerchantStatusAdminSummaryResult {
  byUser: UserMerchantPassSummary[];
  grandTotal: MerchantStatusSummaryCounts;
}

/** Monetization / MerchantDetails / Advertiser Status 原始行（多平台字段名兼容） */
export interface MonetizationBrandRow {
  brand_id?: string | number;
  mid?: string | number;
  mcid?: string;
  /** LinkHaitao Advertiser Status API */
  m_id?: string;
  merchant_name?: string;
  sitename?: string;
  site_url?: string;
  relationship?: string;
  /** LinkHaitao join_status 文本 */
  join_status?: string;
  brand_status?: string;
  merchant_status?: string;
}
