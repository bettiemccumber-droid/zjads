import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

const PHP_MONETIZATION: Record<string, string> = {
  linkbux: 'https://www.linkbux.com/api.php',
};

const MIN_REQUEST_INTERVAL_MS = 2200;
let lastRequestAt = 0;

/**
 * 拉取 PHP Monetization API（mod=medium&op=monetization_api）
 */
export async function fetchPhpMonetizationBrands(
  platformCode: string,
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const baseUrl = PHP_MONETIZATION[platformCode];
  if (!baseUrl) {
    throw new Error(`平台 ${platformCode} 不支持 PHP Monetization API`);
  }

  const all: MonetizationBrandRow[] = [];
  const midFilter = filter?.mids?.filter(Boolean) ?? [];

  if (midFilter.length > 0) {
    for (const mid of midFilter) {
      const rows = await fetchPhpMonetizationOnce_(baseUrl, apiToken, { brand_id: mid, mcid: mid });
      all.push(...rows);
    }
    return dedupeMonetizationRows_(all);
  }

  let page = 1;
  let hasMore = true;
  while (hasMore && page <= 20) {
    const rows = await fetchPhpMonetizationOnce_(baseUrl, apiToken, {
      page: String(page),
      limit: '2000',
    });
    all.push(...rows);
    hasMore = rows.length >= 2000;
    page += 1;
    if (rows.length === 0) break;
  }

  return dedupeMonetizationRows_(all);
}

async function fetchPhpMonetizationOnce_(
  baseUrl: string,
  apiToken: string,
  extra: Record<string, string>,
): Promise<MonetizationBrandRow[]> {
  await throttlePhpRequest_();

  const params = new URLSearchParams({
    mod: 'medium',
    op: 'monetization_api',
    type: 'json',
    token: apiToken,
    ...extra,
  });

  const url = `${baseUrl}?${params.toString()}`;
  const { data } = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 120000,
    validateStatus: () => true,
  });

  if (typeof data === 'string') {
    throw new Error(data.slice(0, 200) || 'Monetization API 无响应');
  }

  const root = data as Record<string, unknown>;
  const status = root.status as Record<string, unknown> | undefined;
  const code = status?.code ?? root.code;
  if (code != null && code !== 0 && code !== '0' && code !== 200 && code !== '200') {
    const msg = String(status?.msg ?? root.msg ?? root.message ?? 'Monetization API 错误');
    throw new Error(msg);
  }

  const payload = root.data ?? root.list ?? root.payload;
  if (!Array.isArray(payload)) return [];
  return payload as MonetizationBrandRow[];
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

async function throttlePhpRequest_() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

/** 支持 PHP Monetization 的平台 */
export const PHP_MONETIZATION_PLATFORMS = new Set(Object.keys(PHP_MONETIZATION));
