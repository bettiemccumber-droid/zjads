import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

/** LinkHaitao Advertiser Status API */
export const LH_ADVERTISER_STATUS_OP = 'merchantCheckList3';

const LH_API_BASE = 'https://www.linkhaitao.com/api.php';
const MIN_REQUEST_INTERVAL_MS = 4200;
const PER_PAGE = 1000;
const MAX_STATUS_PAGES = 100;
/** 9999 频率限制时最多重试次数 */
const RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_RETRY_WAIT_MS = 10000;

/** join_status: 1=No Relationship, 2=Processing, 3=Rejected, 4=Joined */
const LH_JOINED_STATUS = '4';
const LH_OTHER_JOIN_STATUSES = ['2', '3', '1'] as const;

let lastRequestAt = 0;

interface LhAdvertiserStatusRow {
  m_id?: string | number;
  mid?: string | number;
  mcid?: string;
  brand_id?: string | number;
  merchant_id?: string | number;
  sitename?: string;
  site_url?: string;
  datetime?: string;
  join_status?: string | number;
  merchant_status?: string | number;
  relationship?: string;
  brand_status?: string;
  tracking_url?: string;
  tracking_url_short?: string;
  adv_type?: string;
  [key: string]: unknown;
}

interface LhStatusScanCombo {
  label: string;
  params: Record<string, string>;
  budgeted: boolean;
}

/**
 * 拉取 LinkHaitao 商家状态
 * 1. monetization_api 按 ID 直查（快，支持数字 MID）
 * 2. merchantCheckList3 分页扫描（兜底）
 * @see LinkHaitao API Documents → Advertiser Status API / Monetization API
 */
export async function fetchLinkHaitaoAdvertiserStatus(
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const wantedKeys = buildWantedKeys_(filter);

  if (wantedKeys) {
    const direct = await fetchLhMonetizationDirect_(apiToken, filter!);
    const directHits = direct.filter((row) => rowMatchesWanted_(row, wantedKeys));
    if (directHits.length > 0) {
      return directHits;
    }
  }

  const byMid = new Map<string, MonetizationBrandRow>();
  const maxOtherStatusCalls = resolveMaxOtherStatusCalls_(wantedKeys);
  let otherStatusCalls = 0;
  let rateLimited = false;

  const scanCombos: LhStatusScanCombo[] = wantedKeys
    ? [
        { label: 'default-joined', params: {}, budgeted: false },
        { label: 'joined-online', params: { join_status: LH_JOINED_STATUS, merchant_status: '1' }, budgeted: false },
        { label: 'joined-offline', params: { join_status: LH_JOINED_STATUS, merchant_status: '0' }, budgeted: false },
        ...LH_OTHER_JOIN_STATUSES.flatMap((joinStatus) => [
          {
            label: `status-${joinStatus}-online`,
            params: { join_status: joinStatus, merchant_status: '1' },
            budgeted: true,
          },
          {
            label: `status-${joinStatus}-offline`,
            params: { join_status: joinStatus, merchant_status: '0' },
            budgeted: true,
          },
        ]),
      ]
    : [
        { label: 'default-joined', params: {}, budgeted: false },
        ...[LH_JOINED_STATUS, ...LH_OTHER_JOIN_STATUSES].flatMap((joinStatus) => [
          { label: `js-${joinStatus}-on`, params: { join_status: joinStatus, merchant_status: '1' }, budgeted: false },
          { label: `js-${joinStatus}-off`, params: { join_status: joinStatus, merchant_status: '0' }, budgeted: false },
        ]),
      ];

  outer: for (const combo of scanCombos) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= MAX_STATUS_PAGES) {
      if (combo.budgeted && wantedKeys && otherStatusCalls >= maxOtherStatusCalls) break outer;

      let pageResult: { rows: LhAdvertiserStatusRow[]; totalPages: number };
      try {
        pageResult = await fetchLhAdvertiserStatusPage_(apiToken, {
          ...combo.params,
          page: String(page),
          per_page: String(PER_PAGE),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (wantedKeys && message.includes('9999')) {
          rateLimited = true;
          break outer;
        }
        throw err;
      }
      if (combo.budgeted) otherStatusCalls += 1;

      totalPages = pageResult.totalPages;
      ingestLhStatusRows_(pageResult.rows, byMid);

      if (pageResult.rows.length === 0) break;
      if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break outer;
      page += 1;
    }

    if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break outer;
  }

  if (rateLimited && !wantedKeys) {
    throw new Error('请求频率限制，请稍后重试 (9999)');
  }

  if (!wantedKeys) {
    return [...byMid.values()];
  }

  return [...byMid.values()].filter((row) => rowMatchesWanted_(row, wantedKeys));
}

/**
 * monetization_api 按 MID/mcid 直查（LH 后台数字 ID 通常在此接口命中）
 */
async function fetchLhMonetizationDirect_(
  apiToken: string,
  filter: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const all: MonetizationBrandRow[] = [];

  for (const mid of filter.mids?.filter(Boolean) ?? []) {
    const paramSets: Record<string, string>[] = [
      { brand_id: mid },
      { mid },
      { m_id: mid },
      { merchant_id: mid },
    ];
    for (const params of paramSets) {
      const rows = await fetchLhMonetizationPage_(apiToken, params);
      if (rows.length > 0) {
        all.push(...rows);
        break;
      }
    }
  }

  for (const mcid of filter.mcids?.filter(Boolean) ?? []) {
    const rows = await fetchLhMonetizationPage_(apiToken, { mcid });
    all.push(...rows);
  }

  return dedupeLhRows_(all);
}

async function fetchLhMonetizationPage_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<MonetizationBrandRow[]> {
  await throttleLhRequest_();

  const params = new URLSearchParams({
    mod: 'medium',
    op: 'monetization_api',
    type: 'json',
    token: apiToken,
    ...extra,
  });

  const { data } = await axios.post(`${LH_API_BASE}?${params.toString()}`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 120000,
    validateStatus: () => true,
  });

  if (typeof data === 'string') {
    return [];
  }

  const root = data as Record<string, unknown>;
  const status = root.status as Record<string, unknown> | undefined;
  const code = status?.code ?? root.code;
  if (code != null && code !== 0 && code !== '0' && code !== 200 && code !== '200') {
    return [];
  }

  const payload = root.data ?? root.list ?? root.payload;
  if (!Array.isArray(payload)) return [];
  return (payload as Record<string, unknown>[]).map(mapLhMonetizationRow_);
}

function mapLhMonetizationRow_(row: Record<string, unknown>): MonetizationBrandRow {
  return {
    brand_id: row.brand_id as string | number | undefined,
    mid: row.mid as string | number | undefined,
    m_id: row.m_id != null ? String(row.m_id) : undefined,
    mcid: row.mcid != null ? String(row.mcid) : undefined,
    merchant_name: row.merchant_name != null ? String(row.merchant_name) : undefined,
    sitename: row.sitename != null ? String(row.sitename) : undefined,
    site_url: row.site_url != null ? String(row.site_url) : undefined,
    relationship: row.relationship != null ? String(row.relationship) : undefined,
    join_status: row.join_status != null ? String(row.join_status) : undefined,
    brand_status: row.brand_status != null ? String(row.brand_status) : undefined,
    merchant_status: row.merchant_status != null ? String(row.merchant_status) : undefined,
  };
}

/**
 * LH Advertiser Status API 要求 mod/op 在 URL query 上（与点击/佣金采集一致）
 */
async function fetchLhAdvertiserStatusPage_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<{ rows: LhAdvertiserStatusRow[]; totalPages: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep_(RATE_LIMIT_RETRY_WAIT_MS);
    }

    await throttleLhRequest_();

    const { data } = await axios.get(LH_API_BASE, {
      params: {
        mod: 'medium',
        op: LH_ADVERTISER_STATUS_OP,
        token: apiToken,
        ...extra,
      },
      timeout: 120000,
      validateStatus: () => true,
    });

    if (typeof data === 'string') {
      throw new Error(data.slice(0, 200) || 'Advertiser Status API 无响应');
    }

    const root = data as Record<string, unknown>;
    const status = root.status as Record<string, unknown> | undefined;
    const code = status?.code ?? root.code;

    if (code === 9999 || code === '9999') {
      lastError = new Error('请求频率限制，请稍后重试 (9999)');
      continue;
    }
    if (code != null && code !== 0 && code !== '0' && code !== 200 && code !== '200') {
      const msg = String(status?.msg ?? root.msg ?? 'Advertiser Status API 错误');
      throw new Error(msg);
    }

    return extractLhAdvertiserStatusPage_(root);
  }

  throw lastError ?? new Error('Advertiser Status API 无响应');
}

/** 解析 merchantCheckList3 分页结果 */
function extractLhAdvertiserStatusPage_(root: Record<string, unknown>): {
  rows: LhAdvertiserStatusRow[];
  totalPages: number;
} {
  if (Array.isArray(root.data)) {
    return { rows: root.data as LhAdvertiserStatusRow[], totalPages: 1 };
  }

  const nested = root.data as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.list)) {
    const totalPages = Math.max(1, Number(nested.total_page ?? nested.totalPage ?? 1));
    return { rows: nested.list as LhAdvertiserStatusRow[], totalPages };
  }

  if (Array.isArray(root.list)) {
    const total = root.total as Record<string, unknown> | undefined;
    const totalPages = Math.max(1, Number(total?.total_page ?? root.total_page ?? 1));
    return { rows: root.list as LhAdvertiserStatusRow[], totalPages };
  }

  return { rows: [], totalPages: 1 };
}

function resolveMaxOtherStatusCalls_(wantedKeys: Set<string> | null): number {
  if (!wantedKeys) return Number.MAX_SAFE_INTEGER;
  const n = wantedKeys.size;
  if (n <= 1) return 8;
  if (n <= 10) return 16;
  if (n <= 50) return 24;
  return Math.min(40, 16 + Math.ceil(n / 8));
}

function ingestLhStatusRows_(rows: LhAdvertiserStatusRow[], byMid: Map<string, MonetizationBrandRow>) {
  for (const row of rows) {
    const mapped = mapLhStatusRow_(row);
    const dedupeKey =
      String(row.m_id ?? row.mid ?? row.mcid ?? row.brand_id ?? mapped.mcid ?? mapped.mid ?? '') ||
      mapped.sitename ||
      '';
    if (!dedupeKey) continue;
    byMid.set(dedupeKey, mapped);
  }
}

function dedupeLhRows_(rows: MonetizationBrandRow[]): MonetizationBrandRow[] {
  const map = new Map<string, MonetizationBrandRow>();
  for (const row of rows) {
    const id = row.brand_id ?? row.mid ?? row.m_id ?? row.mcid;
    if (id == null) continue;
    map.set(String(id), row);
  }
  return [...map.values()];
}

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapLhStatusRow_(row: LhAdvertiserStatusRow): MonetizationBrandRow {
  return {
    m_id: row.m_id != null ? String(row.m_id) : undefined,
    mid:
      row.mid != null
        ? String(row.mid)
        : row.brand_id != null
          ? String(row.brand_id)
          : row.merchant_id != null
            ? String(row.merchant_id)
            : undefined,
    mcid: row.mcid != null ? String(row.mcid) : undefined,
    sitename: row.sitename,
    site_url: row.site_url,
    relationship: row.relationship != null ? String(row.relationship) : undefined,
    join_status: row.join_status != null ? String(row.join_status) : undefined,
    brand_status: row.brand_status != null ? String(row.brand_status) : undefined,
    merchant_status: row.merchant_status != null ? String(row.merchant_status) : undefined,
  };
}

function buildWantedKeys_(filter?: { mids?: string[]; mcids?: string[] }): Set<string> | null {
  if (!filter) return null;
  const mids = filter.mids?.filter(Boolean) ?? [];
  const mcids = filter.mcids?.filter(Boolean) ?? [];
  if (mids.length === 0 && mcids.length === 0) return null;

  const keys = new Set<string>();
  for (const mid of mids) keys.add(`mid:${mid}`);
  for (const mcid of mcids) keys.add(`mcid:${mcid.toLowerCase()}`);
  return keys;
}

function rowMatchesWanted_(row: MonetizationBrandRow, wanted: Set<string>): boolean {
  const ids = extractLhRowIds_(row);
  for (const mid of ids.mids) {
    if (wanted.has(`mid:${mid}`)) return true;
  }
  for (const mcid of ids.mcids) {
    if (wanted.has(`mcid:${mcid}`)) return true;
  }
  return false;
}

function allWantedFound_(wanted: Set<string>, byMid: Map<string, MonetizationBrandRow>): boolean {
  for (const key of wanted) {
    const [, id] = key.split(':');
    let hit = false;
    for (const row of byMid.values()) {
      const ids = extractLhRowIds_(row);
      if (key.startsWith('mid:') && ids.mids.includes(id)) {
        hit = true;
        break;
      }
      if (key.startsWith('mcid:') && ids.mcids.includes(id.toLowerCase())) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

/** 从 LH 行提取全部可用的数字 MID / slug mcid */
function extractLhRowIds_(row: MonetizationBrandRow): { mids: string[]; mcids: string[] } {
  const mids = new Set<string>();
  const mcids = new Set<string>();
  for (const raw of [row.brand_id, row.mid, row.m_id, row.mcid]) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (/^\d+$/.test(s)) mids.add(s);
    else mcids.add(s.toLowerCase());
  }
  return { mids: [...mids], mcids: [...mcids] };
}

async function throttleLhRequest_() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}
