import axios from 'axios';
import { MonetizationBrandRow } from '../merchant-status.types';

/** LinkHaitao Advertiser Status API */
export const LH_ADVERTISER_STATUS_OP = 'merchantCheckList3';

const LH_API_BASE = 'https://www.linkhaitao.com/api.php';
const MIN_REQUEST_INTERVAL_MS = 4200;
const MAX_PAGES = 20;
const PER_PAGE = 1000;
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
  sitename?: string;
  site_url?: string;
  datetime?: string;
  join_status?: string | number;
  merchant_status?: string | number;
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
  const maxOtherStatusCalls = resolveMaxOtherStatusCalls_(wantedKeys);
  let otherStatusCalls = 0;
  let rateLimited = false;

  /**
   * 有明确查询目标时：已 Join 列表优先全量分页（不受 12 次上限），
   * 避免 Joined 商家排在较后页时被误判为「无商家」。
   */
  const scanCombos: Array<{ joinStatus: string; budgeted: boolean }> = wantedKeys
    ? [
        { joinStatus: LH_JOINED_STATUS, budgeted: false },
        ...LH_OTHER_JOIN_STATUSES.map((joinStatus) => ({ joinStatus, budgeted: true })),
      ]
    : [
        { joinStatus: LH_JOINED_STATUS, budgeted: false },
        ...LH_OTHER_JOIN_STATUSES.map((joinStatus) => ({ joinStatus, budgeted: false })),
      ];

  outer: for (const { joinStatus, budgeted } of scanCombos) {
    for (const merchantStatus of ['1', '0'] as const) {
      let page = 1;
      while (page <= MAX_PAGES) {
        if (budgeted && wantedKeys && otherStatusCalls >= maxOtherStatusCalls) break outer;

        let rows: LhAdvertiserStatusRow[];
        try {
          rows = await fetchLhAdvertiserStatusPage_(apiToken, {
            join_status: joinStatus,
            merchant_status: merchantStatus,
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
        if (budgeted) otherStatusCalls += 1;

        ingestLhStatusRows_(rows, byMid);

        if (rows.length < PER_PAGE) break;
        if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break outer;
        page += 1;
      }
      if (wantedKeys && allWantedFound_(wantedKeys, byMid)) break outer;
    }
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
 * LH Advertiser Status API 要求 mod/op 在 URL query 上（与点击/佣金采集一致）
 * @see https://www.linkhaitao.com/api.php?mod=medium&op=merchantCheckList3
 */
async function fetchLhAdvertiserStatusPage_(
  apiToken: string,
  extra: Record<string, string>,
): Promise<LhAdvertiserStatusRow[]> {
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

    return extractLhAdvertiserStatusList_(root);
  }

  throw lastError ?? new Error('Advertiser Status API 无响应');
}

/**
 * 非 Joined 状态的扫描预算（Joined 已优先全量分页）
 */
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
    const dedupeKey = String(row.m_id ?? row.mid ?? row.mcid ?? mapped.mcid ?? mapped.mid ?? '');
    if (!dedupeKey) continue;
    byMid.set(dedupeKey, mapped);
  }
}

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
    m_id: row.m_id != null ? String(row.m_id) : undefined,
    mid: row.mid != null ? String(row.mid) : undefined,
    mcid: row.mcid != null ? String(row.mcid) : undefined,
    sitename: row.sitename,
    site_url: row.site_url,
    join_status: row.join_status != null ? String(row.join_status) : undefined,
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
  for (const raw of [row.mid, row.m_id, row.mcid]) {
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
