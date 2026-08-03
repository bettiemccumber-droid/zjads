import { postRewardooApi } from '../../collectors/rewardoo-api.util';
import { MonetizationBrandRow } from '../merchant-status.types';

/** Rewardoo MerchantDetails API（mod=medium&op=merchant_details） */
export const RW_MERCHANT_DETAILS_OP = 'merchant_details';

const MAX_MID_PER_REQUEST = 200;
const PAGE_LIMIT = 1000;

/**
 * 拉取 Rewardoo MerchantDetails（商家详情 / Join 关系 / merchant_status）
 * @see Rewardoo API Documents → MerchantDetails API
 */
export async function fetchRewardooMerchantDetails(
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const midFilter = filter?.mids?.filter(Boolean) ?? [];
  const mcidFilter = filter?.mcids?.filter(Boolean) ?? [];
  const all: MonetizationBrandRow[] = [];

  if (midFilter.length > 0) {
    for (let i = 0; i < midFilter.length; i += MAX_MID_PER_REQUEST) {
      const chunk = midFilter.slice(i, i + MAX_MID_PER_REQUEST);
      const rows = await fetchRewardooMerchantDetailsPage_(apiToken, {
        mid: chunk.join(','),
      });
      all.push(...rows);
    }
    return dedupeRows_(all);
  }

  if (mcidFilter.length > 0) {
    for (let i = 0; i < mcidFilter.length; i += MAX_MID_PER_REQUEST) {
      const chunk = mcidFilter.slice(i, i + MAX_MID_PER_REQUEST);
      const rows = await fetchRewardooMerchantDetailsPage_(apiToken, {
        mcid: chunk.join(','),
      });
      all.push(...rows);
    }
    return dedupeRows_(all);
  }

  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const { rows, pages } = await fetchRewardooMerchantDetailsPageWithMeta_(apiToken, {
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    all.push(...rows);
    totalPages = pages;
    page += 1;
    if (rows.length === 0) break;
  }

  return dedupeRows_(all);
}

async function fetchRewardooMerchantDetailsPage_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<MonetizationBrandRow[]> {
  const { rows } = await fetchRewardooMerchantDetailsPageWithMeta_(apiToken, extra);
  return rows;
}

async function fetchRewardooMerchantDetailsPageWithMeta_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<{ rows: MonetizationBrandRow[]; pages: number }> {
  const result = await postRewardooApi('medium', RW_MERCHANT_DETAILS_OP, {
    token: apiToken,
    type: 'json',
    ...extra,
  });

  if (result.code === 1000) {
    throw new Error('Invalid token');
  }
  if (result.code !== 0 && result.code !== undefined) {
    throw new Error(result.message ?? 'MerchantDetails API 错误');
  }

  return {
    rows: result.rows as MonetizationBrandRow[],
    pages: result.totalPages ?? 1,
  };
}

function dedupeRows_(rows: MonetizationBrandRow[]): MonetizationBrandRow[] {
  const map = new Map<string, MonetizationBrandRow>();
  for (const row of rows) {
    const id = row.mid ?? row.brand_id ?? row.mcid;
    if (id == null) continue;
    map.set(String(id), row);
  }
  return [...map.values()];
}
