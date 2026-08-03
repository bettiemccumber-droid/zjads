import {
  fetchJsonMonetizationBrands,
  JSON_MONETIZATION_PLATFORMS,
} from './adapters/json-monetization.adapter';
import {
  fetchPhpMonetizationBrands,
  PHP_MONETIZATION_PLATFORMS,
} from './adapters/php-monetization.adapter';
import { fetchLinkHaitaoAdvertiserStatus } from './adapters/linkhaitao-advertiser-status.adapter';
import { fetchRewardooMerchantDetails } from './adapters/rewardoo-merchant-details.adapter';
import {
  buildActionLabel,
  isMerchantActionable,
  mapMonetizationBrandRow,
  monetizationRowMatchesQuery,
} from './merchant-status-normalizer';
import {
  MerchantQueryItem,
  MerchantStatusRow,
  MerchantStatusSummaryCounts,
  MonetizationBrandRow,
} from './merchant-status.types';

export interface MerchantStatusQueryContext {
  query: MerchantQueryItem;
  queryKey: string;
  platformCode: string;
  platformName: string;
  channelAccountId: number;
  channelDisplayName: string;
  affiliateAlias: string;
  ownerUserId: number;
  ownerUsername: string;
  apiToken: string;
}

/** Rewardoo 使用 MerchantDetails API */
const REWARDOO_MERCHANT_DETAILS = 'rewardoo';

/** LinkHaitao 使用 Advertiser Status API（merchantCheckList3） */
const LINKHAITAO_ADVERTISER_STATUS = 'linkhaitao';

/**
 * 判断平台是否支持商家状态查询
 */
export function isMerchantStatusPlatformSupported(platformCode: string): boolean {
  return (
    JSON_MONETIZATION_PLATFORMS.has(platformCode) ||
    PHP_MONETIZATION_PLATFORMS.has(platformCode) ||
    platformCode === REWARDOO_MERCHANT_DETAILS ||
    platformCode === LINKHAITAO_ADVERTISER_STATUS
  );
}

/**
 * 查询单个商家 × 单个渠道账号的状态
 */
export async function queryMerchantStatusForAccount(
  ctx: MerchantStatusQueryContext,
): Promise<MerchantStatusRow> {
  const queriedAt = new Date().toISOString();
  const base = {
    queryKey: ctx.queryKey,
    platformCode: ctx.platformCode,
    platformName: ctx.platformName,
    channelAccountId: ctx.channelAccountId,
    channelDisplayName: ctx.channelDisplayName,
    affiliateAlias: ctx.affiliateAlias,
    ownerUserId: ctx.ownerUserId,
    ownerUsername: ctx.ownerUsername,
    queriedAt,
  };

  if (!isMerchantStatusPlatformSupported(ctx.platformCode)) {
    return buildStatusRow_(base, ctx.query, {
      error: `平台 ${ctx.platformName} 暂不支持商家状态查询`,
    });
  }

  try {
    const brands = await loadMonetizationBrands_(ctx.platformCode, ctx.apiToken, ctx.query);
    const match = brands.find((row) => monetizationRowMatchesQuery(row, ctx.query));

    if (!match) {
      return buildStatusRow_(base, ctx.query, {
        relationshipStatus: 'not_joined',
        relationshipRaw: null,
        merchantAvailability: 'unknown',
        availabilityRaw: null,
      });
    }

    const mapped = mapMonetizationBrandRow(match);
    return buildStatusRow_(base, ctx.query, mapped);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return buildStatusRow_(base, ctx.query, { error: message });
  }
}

/**
 * 按平台批量预加载 Monetization 列表（同账号多 MID 时减少 API 调用）
 */
export async function preloadMonetizationBrandsForAccount(
  platformCode: string,
  apiToken: string,
  queries: MerchantQueryItem[],
): Promise<MonetizationBrandRow[]> {
  const mids = queries.map((q) => q.merchantId?.trim()).filter(Boolean) as string[];
  const mcids = queries.map((q) => q.mcid?.trim()).filter(Boolean) as string[];

  if (mids.length > 0 || mcids.length > 0) {
    return loadMonetizationBrands_(platformCode, apiToken, { mids, mcids });
  }

  return loadMonetizationBrands_(platformCode, apiToken);
}

/**
 * 在预加载列表中匹配并构建结果行
 */
export function matchMerchantStatusFromPreload(
  ctx: Omit<MerchantStatusQueryContext, 'apiToken'>,
  brands: MonetizationBrandRow[],
): MerchantStatusRow {
  const queriedAt = new Date().toISOString();
  const base = {
    queryKey: ctx.queryKey,
    platformCode: ctx.platformCode,
    platformName: ctx.platformName,
    channelAccountId: ctx.channelAccountId,
    channelDisplayName: ctx.channelDisplayName,
    affiliateAlias: ctx.affiliateAlias,
    ownerUserId: ctx.ownerUserId,
    ownerUsername: ctx.ownerUsername,
    queriedAt,
  };

  const match = brands.find((row) => monetizationRowMatchesQuery(row, ctx.query));
  if (!match) {
    return buildStatusRow_(base, ctx.query, {
      relationshipStatus: 'not_joined',
      relationshipRaw: null,
      merchantAvailability: 'unknown',
      availabilityRaw: null,
    });
  }

  return buildStatusRow_(base, ctx.query, mapMonetizationBrandRow(match));
}

async function loadMonetizationBrands_(
  platformCode: string,
  apiToken: string,
  query?: { mids?: string[]; mcids?: string[] } | MerchantQueryItem,
): Promise<MonetizationBrandRow[]> {
  const filter =
    query && ('mids' in query || 'mcids' in query)
      ? query
      : {
          mids: (query as MerchantQueryItem)?.merchantId
            ? [(query as MerchantQueryItem).merchantId!]
            : [],
          mcids: (query as MerchantQueryItem)?.mcid ? [(query as MerchantQueryItem).mcid!] : [],
        };

  if (JSON_MONETIZATION_PLATFORMS.has(platformCode)) {
    return fetchJsonMonetizationBrands(platformCode, apiToken, filter);
  }
  if (platformCode === REWARDOO_MERCHANT_DETAILS) {
    return fetchRewardooMerchantDetails(apiToken, filter);
  }
  if (platformCode === LINKHAITAO_ADVERTISER_STATUS) {
    return fetchLinkHaitaoAdvertiserStatus(apiToken, filter);
  }
  return fetchPhpMonetizationBrands(platformCode, apiToken, filter);
}

function buildStatusRow_(
  base: Omit<
    MerchantStatusRow,
    | 'merchantId'
    | 'mcid'
    | 'merchantName'
    | 'siteUrl'
    | 'relationshipStatus'
    | 'relationshipRaw'
    | 'merchantAvailability'
    | 'availabilityRaw'
    | 'actionable'
    | 'actionLabel'
    | 'error'
  >,
  query: MerchantQueryItem,
  mapped: Partial<ReturnType<typeof mapMonetizationBrandRow>> & { error?: string },
): MerchantStatusRow {
  const hasError = Boolean(mapped.error);
  const relationshipStatus = mapped.relationshipStatus ?? 'unknown';
  const merchantAvailability = mapped.merchantAvailability ?? 'unknown';
  const actionLabel = buildActionLabel(relationshipStatus, merchantAvailability, hasError);

  return {
    ...base,
    merchantId: mapped.merchantId ?? query.merchantId ?? null,
    mcid: mapped.mcid ?? query.mcid ?? null,
    merchantName: mapped.merchantName ?? null,
    siteUrl: mapped.siteUrl ?? null,
    relationshipStatus,
    relationshipRaw: mapped.relationshipRaw ?? null,
    merchantAvailability,
    availabilityRaw: mapped.availabilityRaw ?? null,
    actionable: !hasError && isMerchantActionable(relationshipStatus, merchantAvailability),
    actionLabel,
    error: mapped.error ?? null,
  };
}

/**
 * 汇总查询结果统计
 */
export function summarizeMerchantStatusRows(rows: MerchantStatusRow[]): MerchantStatusSummaryCounts {
  const summary: MerchantStatusSummaryCounts = {
    total: rows.length,
    actionable: 0,
    pending: 0,
    rejected: 0,
    notJoined: 0,
    offline: 0,
    unknown: 0,
    failed: 0,
  };

  for (const row of rows) {
    if (row.error) {
      summary.failed += 1;
      continue;
    }
    if (row.actionable) summary.actionable += 1;
    else if (row.relationshipStatus === 'pending') summary.pending += 1;
    else if (row.relationshipStatus === 'rejected') summary.rejected += 1;
    else if (row.relationshipStatus === 'not_joined') summary.notJoined += 1;
    else if (row.merchantAvailability === 'offline') summary.offline += 1;
    else summary.unknown += 1;
  }

  return summary;
}

/**
 * 构建查询项 stable key
 */
export function buildMerchantQueryKey(item: MerchantQueryItem): string {
  if (item.merchantId?.trim()) return item.merchantId.trim();
  if (item.mcid?.trim()) return `mcid:${item.mcid.trim().toLowerCase()}`;
  if (item.domain?.trim()) return `domain:${item.domain.trim().toLowerCase()}`;
  return 'unknown';
}
