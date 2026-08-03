import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

const JSON_MONETIZATION: Record<
  string,
  { url: string; source: string }
> = {
  ultrainfluence: {
    url: 'https://api.ultrainfluence.com/api/monetization',
    source: 'ultrainfluence',
  },
  partnermatic: {
    url: 'https://api.partnermatic.com/api/monetization',
    source: 'partnermatic',
  },
};

/**
 * 拉取 JSON Monetization API 全量或按 mid/mcid 过滤列表
 */
export async function fetchJsonMonetizationBrands(
  platformCode: string,
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const cfg = JSON_MONETIZATION[platformCode];
  if (!cfg) {
    throw new Error(`平台 ${platformCode} 不支持 JSON Monetization API`);
  }

  const all: MonetizationBrandRow[] = [];
  const midFilter = filter?.mids?.filter(Boolean) ?? [];
  const mcidFilter = filter?.mcids?.filter(Boolean) ?? [];

  /** 有明确 ID 时分批查询（API 上限 200） */
  if (midFilter.length > 0) {
    for (let i = 0; i < midFilter.length; i += 200) {
      const chunk = midFilter.slice(i, i + 200);
      const rows = await fetchJsonMonetizationPage_(cfg.url, cfg.source, apiToken, {
        mid: chunk.join(','),
      });
      all.push(...rows);
    }
    return dedupeMonetizationRows_(all);
  }

  if (mcidFilter.length > 0) {
    for (let i = 0; i < mcidFilter.length; i += 200) {
      const chunk = mcidFilter.slice(i, i + 200);
      const rows = await fetchJsonMonetizationPage_(cfg.url, cfg.source, apiToken, {
        mcid: chunk.join(','),
      });
      all.push(...rows);
    }
    return dedupeMonetizationRows_(all);
  }

  /** 无过滤时分页拉取（上限 20 页防止滥用） */
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 20) {
    const { rows, pages } = await fetchJsonMonetizationPageWithMeta_(
      cfg.url,
      cfg.source,
      apiToken,
      { curPage: page, perPage: 2000 },
    );
    all.push(...rows);
    totalPages = pages;
    page += 1;
    if (rows.length === 0) break;
  }

  return dedupeMonetizationRows_(all);
}

async function fetchJsonMonetizationPage_(
  url: string,
  source: string,
  apiToken: string,
  extra: Record<string, string | number>,
): Promise<MonetizationBrandRow[]> {
  const { rows } = await fetchJsonMonetizationPageWithMeta_(url, source, apiToken, extra);
  return rows;
}

async function fetchJsonMonetizationPageWithMeta_(
  url: string,
  source: string,
  apiToken: string,
  extra: Record<string, string | number>,
): Promise<{ rows: MonetizationBrandRow[]; pages: number }> {
  const response = await axios.post(
    url,
    {
      source,
      token: apiToken,
      approval_type: '',
      offer_type: '',
      relationship: '',
      categories: '',
      country: '',
      curPage: 1,
      perPage: 2000,
      ...extra,
    },
    { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
  );

  if (response.data?.code === '1002') {
    await sleep_(2000);
    return fetchJsonMonetizationPageWithMeta_(url, source, apiToken, extra);
  }

  if (response.data?.code !== '0' && response.data?.code !== 0) {
    throw new Error(response.data?.message ?? 'Monetization API 错误');
  }

  const list = (response.data?.data?.list ?? []) as MonetizationBrandRow[];
  const pages = Number(response.data?.data?.total_page ?? 1) || 1;
  return { rows: list, pages };
}

function dedupeMonetizationRows_(rows: MonetizationBrandRow[]): MonetizationBrandRow[] {
  const map = new Map<string, MonetizationBrandRow>();
  for (const row of rows) {
    const id = row.brand_id ?? row.mid ?? row.mcid;
    if (id == null) continue;
    map.set(String(id), row);
  }
  return [...map.values()];
}

function sleep_(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 支持 JSON Monetization 的平台 */
export const JSON_MONETIZATION_PLATFORMS = new Set(Object.keys(JSON_MONETIZATION));
