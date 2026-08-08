import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

/** LinkHaitao Advertiser Status API */
export const LH_ADVERTISER_STATUS_OP = 'merchantCheckList3';

const LH_API_BASE = 'https://www.linkhaitao.com/api.php';
const MIN_REQUEST_INTERVAL_MS = 4200;
const MAX_PAGES = 20;
const PER_PAGE = 1000;

/** join_status: 1=No Relationship, 2=Processing, 3=Rejected, 4=Joined */
const LH_JOIN_STATUSES = ['4', '2', '3', '1'] as const;

let lastRequestAt = 0;

interface LhAdvertiserStatusRow {
  m_id?: string;
  sitename?: string;
  site_url?: string;
  datetime?: string;
  join_status?: string;
  merchant_status?: string;
  tracking_url?: string;
  tracking_url_short?: string;
  adv_type?: string;
}

/**
 * 拉取 LinkHaitao Advertiser Status API（merchantCheckList3）
 * @see LinkHaitao API Documents → Advertiser Status API
 */
export async function fetchLinkHaitaoAdvertiserStatus(
  apiToken: string,
  filter?: { mids?: string[]; mcids?: string[] },
): Promise<MonetizationBrandRow[]> {
  const wantedKeys = buildWantedKeys_(filter);
  const byMid = new Map<string, MonetizationBrandRow>();

  /** 每种 join_status 分页拉取；有 MID 过滤时在找齐后提前停止 */
  for (const joinStatus of LH_JOIN_STATUSES) {
    for (const merchantStatus of ['1', '0'] as const) {
      let page = 1;
      while (page <= MAX_PAGES) {
        const rows = await fetchLhAdvertiserStatusPage_(apiToken, {
          join_status: joinStatus,
          merchant_status: merchantStatus,
          page: String(page),
          per_page: String(PER_PAGE),
        });

        for (const row of rows) {
          const mapped = mapLhStatusRow_(row);
          const dedupeKey = String(row.m_id ?? mapped.mcid ?? mapped.mid ?? '');
          if (!dedupeKey) continue;
          byMid.set(dedupeKey, mapped);
        }

        if (rows.length < PER_PAGE) break;
        if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break;
        page += 1;
      }
      if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break;
    }
    if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break;
  }

  if (!wantedKeys) {
    return [...byMid.values()];
  }

  return [...byMid.values()].filter((row) => rowMatchesWanted_(row, wantedKeys));
}

/**
 * LH Advertiser Status API 要求 mod/op 在 URL query 上（与点击/佣金采集一致）
 * @see https://www.linkhaitao.com/api.php?mod=medium&op=merchantCheckList3
 */
async function fetchLhAdvertiserStatusPage_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<LhAdvertiserStatusRow[]> {
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
    throw new Error('请求频率限制，请稍后重试 (9999)');
  }
  if (code != null && code !== 0 && code !== '0' && code !== 200 && code !== '200') {
    const msg = String(status?.msg ?? root.msg ?? 'Advertiser Status API 错误');
    throw new Error(msg);
  }

  return extractLhAdvertiserStatusList_(root);
}

/** 解析 merchantCheckList3 返回列表（兼容 data[] / data.list / list） */
function extractLhAdvertiserStatusList_(root: Record<string, unknown>): LhAdvertiserStatusRow[] {
  if (Array.isArray(root.data)) {
    return root.data as LhAdvertiserStatusRow[];
  }

  const nested = root.data as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.list)) {
    return nested.list as LhAdvertiserStatusRow[];
  }

  if (Array.isArray(root.list)) {
    return root.list as LhAdvertiserStatusRow[];
  }

  return [];
}

function mapLhStatusRow_(row: LhAdvertiserStatusRow): MonetizationBrandRow {
  return {
    m_id: row.m_id,
    sitename: row.sitename,
    site_url: row.site_url,
    join_status: row.join_status,
    merchant_status: row.merchant_status,
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
  const mid = row.mid ?? (row.m_id && /^\d+$/.test(String(row.m_id)) ? row.m_id : null);
  const mcid = row.mcid ?? (row.m_id && !/^\d+$/.test(String(row.m_id)) ? row.m_id : null);
  if (mid && wanted.has(`mid:${mid}`)) return true;
  if (mcid && wanted.has(`mcid:${String(mcid).toLowerCase()}`)) return true;
  return false;
}

function allWantedFound_(wanted: Set<string>, byMid: Map<string, MonetizationBrandRow>): boolean {
  for (const key of wanted) {
    const [, id] = key.split(':');
    let hit = false;
    for (const row of byMid.values()) {
      if (key.startsWith('mid:') && (String(row.mid ?? '') === id || String(row.m_id ?? '') === id)) {
        hit = true;
        break;
      }
      if (
        key.startsWith('mcid:') &&
        (String(row.mcid ?? '').toLowerCase() === id ||
          String(row.m_id ?? '').toLowerCase() === id)
      ) {
        hit = true;
        break;
      }
    }
    if (!hit) return false;
  }
  return true;
}

async function throttleLhRequest_() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}
