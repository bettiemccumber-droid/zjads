import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

/** LinkHaitao Monetization API（支持 mid/mcid 直查与 relationship） */
const LH_MONETIZATION_URL = 'https://api.linkhaitao.com/api/monetization';
const LH_SOURCE = 'linkhaitao';
const MIN_REQUEST_INTERVAL_MS = 800;
const MAX_ID_BATCH = 200;
const MAX_FULL_SCAN_PAGES = 20;
const PER_PAGE = 2000;
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_RETRY_WAIT_MS = 5000;

let lastRequestAt = 0;

interface LhMonetizationRow {
  mcid?: string;
  mid?: string | number;
  brand_id?: string | number;
  merchant_name?: string;
  site_url?: string;
  relationship?: string;
  brand_status?: string;
  merchant_status?: string;
  [key: string]: unknown;
}

/**
 * 拉取 LinkHaitao 商家状态（Monetization API）
 * 支持数字 brand_id/mid 直查；需 POST + application/x-www-form-urlencoded。
 * @see LinkHaitao API Documents → Monetization API
 */
export async function fetchLinkHaitaoAdvertiserStatus(
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const midFilter = filter?.mids?.filter(Boolean) ?? [];
  const mcidFilter = filter?.mcids?.filter(Boolean) ?? [];

  if (midFilter.length > 0) {
    return fetchLhMonetizationByKey_(apiToken, 'mid', midFilter);
  }
  if (mcidFilter.length > 0) {
    return fetchLhMonetizationByKey_(apiToken, 'mcid', mcidFilter.map((v) => v.toLowerCase()));
  }

  return fetchLhMonetizationAll_(apiToken);
}

/** 按 mid/mcid 分批直查（单次最多 200） */
async function fetchLhMonetizationByKey_(
  apiToken: string,
  key: 'mid' | 'mcid',
  values: string[],
): Promise<MonetizationBrandRow[]> {
  const all: MonetizationBrandRow[] = [];

  for (let i = 0; i < values.length; i += MAX_ID_BATCH) {
    const chunk = values.slice(i, i + MAX_ID_BATCH);
    const page = await fetchLhMonetizationPage_(apiToken, { [key]: chunk.join(',') });
    all.push(...page.rows);
  }

  return dedupeLhRows_(all);
}

/** 无过滤时分页拉取 */
async function fetchLhMonetizationAll_(apiToken: string): Promise<MonetizationBrandRow[]> {
  const all: MonetizationBrandRow[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_FULL_SCAN_PAGES) {
    const result = await fetchLhMonetizationPage_(apiToken, {
      curPage: String(page),
      perPage: String(PER_PAGE),
    });
    all.push(...result.rows);
    totalPages = Math.max(totalPages, result.totalPages);
    if (result.rows.length === 0) break;
    page += 1;
  }

  return dedupeLhRows_(all);
}

async function fetchLhMonetizationPage_(
  apiToken: string,
  extra: Record<string, string | number>,
): Promise<{ rows: MonetizationBrandRow[]; totalPages: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep_(RATE_LIMIT_RETRY_WAIT_MS);
    }

    await throttleLhRequest_();

    const body = new URLSearchParams({
      token: apiToken,
      source: LH_SOURCE,
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, String(v)])),
    });

    const { data } = await axios.post(LH_MONETIZATION_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
    });

    if (typeof data === 'string') {
      throw new Error(data.slice(0, 200) || 'Monetization API 无响应');
    }

    const root = data as Record<string, unknown>;
    const code = root.code;

    if (code === '1002' || code === 1002) {
      lastError = new Error('请求频率限制，请稍后重试');
      continue;
    }
    if (code != null && code !== 0 && code !== '0') {
      throw new Error(String(root.message ?? 'Monetization API 错误'));
    }

    const payload = root.data as Record<string, unknown> | undefined;
    const list = Array.isArray(payload?.list) ? (payload.list as LhMonetizationRow[]) : [];
    const totalPages = Math.max(1, Number(payload?.total_page ?? 1));

    return { rows: list.map(mapLhMonetizationRow_), totalPages };
  }

  throw lastError ?? new Error('Monetization API 无响应');
}

function mapLhMonetizationRow_(row: LhMonetizationRow): MonetizationBrandRow {
  return {
    brand_id: row.brand_id,
    mid: row.mid != null ? String(row.mid) : undefined,
    mcid: row.mcid != null ? String(row.mcid) : undefined,
    merchant_name: row.merchant_name,
    site_url: row.site_url,
    relationship: row.relationship != null ? String(row.relationship) : undefined,
    brand_status: row.brand_status != null ? String(row.brand_status) : undefined,
    merchant_status: row.merchant_status != null ? String(row.merchant_status) : undefined,
  };
}

function dedupeLhRows_(rows: MonetizationBrandRow[]): MonetizationBrandRow[] {
  const map = new Map<string, MonetizationBrandRow>();
  for (const row of rows) {
    const id = row.brand_id ?? row.mid ?? row.mcid;
    if (id == null) continue;
    map.set(String(id), row);
  }
  return [...map.values()];
}

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function throttleLhRequest_() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}
