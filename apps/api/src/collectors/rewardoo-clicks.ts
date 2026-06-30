import axios from 'axios';
import {
  fetchRewardooPerformancePages,
  parseRwApiEnvelope,
  RW_API_BASE,
} from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

interface RwClickRow {
  mid?: string | number;
  m_id?: string | number;
  merchant_id?: string | number;
  merchant_name?: string;
  click_time?: string;
  click_ref?: string;
}

/** Rewardoo ClickDetails：60 秒内最多 15 次（文档错误码 1006） */
const RW_CLICK_MIN_INTERVAL_MS = 4100;

const RW_CLICK_PAGE_SIZE = 500;

/** click_details 仅作兜底且区间不宜过长，避免 7 天 × 24 小时撑爆内存 */
const RW_CLICK_DETAILS_MAX_DAYS = 3;

let lastRwClickRequestAt = 0;

/**
 * 生成 RW click_details 小时片（UTC+8 自然日，结束时间为下一整点，与官方示例一致）。
 */
export function buildRwClickHourlySlots(
  startDate: string,
  endDate: string,
): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const dates = listUtc8Dates_(startDate, endDate);

  for (const ymd of dates) {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, '0');
      const begin = `${ymd} ${hh}:00:00`;
      let end: string;
      if (h < 23) {
        end = `${ymd} ${String(h + 1).padStart(2, '0')}:00:00`;
      } else {
        const nextDay = addUtc8Days_(ymd, 1);
        end = nextDay <= endDate ? `${nextDay} 00:00:00` : `${ymd} 23:59:59`;
      }
      slots.push({ begin, end });
    }
  }

  return slots;
}

function countDaysInclusive_(startDate: string, endDate: string): number {
  return listUtc8Dates_(startDate, endDate).length;
}

/**
 * 采集 Rewardoo 联盟点击，按商家+自然日汇总。
 * 优先 performance 商家日报（与 RW 后台 Performance 一致，请求少、内存低）；
 * 仅当 performance 无点击且区间 ≤3 天时，才回退 click_details。
 */
export async function fetchRewardooClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  await onProgress?.({ slotIndex: 0, totalSlots: 1, clicksSoFar: 0 });

  const perfAggs = await fetchRewardooPerformanceClickAggs_(apiToken, startDate, endDate);
  const perfTotal = perfAggs.reduce((s, r) => s + r.clicks, 0);
  if (perfTotal > 0) {
    await onProgress?.({ slotIndex: 1, totalSlots: 1, clicksSoFar: perfTotal });
    return perfAggs;
  }

  const dayCount = countDaysInclusive_(startDate, endDate);
  if (dayCount > RW_CLICK_DETAILS_MAX_DAYS) {
    return perfAggs;
  }

  return fetchRewardooClickDetails_(apiToken, startDate, endDate, onProgress);
}

async function fetchRewardooClickDetails_(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const slots = buildRwClickHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    /** 仅在本小时片内去重，避免 7 天全局 Set 撑爆内存 */
    const slotSeenRefs = new Set<string>();
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 50) {
      const parsed = await postRwClickDetailsPage(
        apiToken,
        slot.begin,
        slot.end,
        page,
      );

      if (parsed.code === 1006) {
        rateRetries += 1;
        if (rateRetries > 15) {
          throw new Error('Rewardoo click_details 频率限制，请稍后重试');
        }
        await sleep(65000);
        continue;
      }

      rateRetries = 0;

      if (parsed.code !== 0) {
        throw new Error(
          `Rewardoo click_details 错误 ${parsed.code}${parsed.message ? `: ${parsed.message}` : ''}`,
        );
      }

      totalPages = parsed.totalPages ?? 1;
      const list = parsed.rows as RwClickRow[];

      for (const row of list) {
        const merchantId = resolveRwClickMerchantId(row);
        if (!merchantId) continue;

        const ref = String(row.click_ref ?? '').trim();
        if (ref) {
          if (slotSeenRefs.has(ref)) continue;
          slotSeenRefs.add(ref);
        }

        const clickDate = parseRwClickDate_(row.click_time);
        if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

        const key = `${merchantId}|${clickDate}`;
        const existing = agg.get(key);
        if (existing) {
          existing.clicks += 1;
        } else {
          agg.set(key, {
            merchantId,
            merchantName: String(row.merchant_name ?? ''),
            clickDate,
            clicks: 1,
          });
        }
      }

      page += 1;
      if (page <= totalPages) await sleep(200);
    }

    slotSeenRefs.clear();

    const clicksSoFar = [...agg.values()].reduce((s, r) => s + r.clicks, 0);
    if (onProgress && (slotIndex === 0 || slotIndex % 6 === 0 || slotIndex === slots.length - 1)) {
      await onProgress({ slotIndex: slotIndex + 1, totalSlots: slots.length, clicksSoFar });
    }
  }

  return Array.from(agg.values());
}

/** performance/merchant|report 按商家+日 clicks 汇总（首选，低内存） */
async function fetchRewardooPerformanceClickAggs_(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();

  for (const op of ['merchant', 'report'] as const) {
    let rows: unknown[] = [];
    try {
      rows = await fetchRewardooPerformancePages(op, apiToken, startDate, endDate);
    } catch {
      continue;
    }

    for (const raw of rows) {
      const row = raw as Record<string, unknown>;
      const merchantId = resolveRwClickMerchantId(row);
      if (!merchantId) continue;

      const clicks = parseRwClickCount_(row.clicks ?? row.click);
      if (clicks <= 0) continue;

      const clickDate = parseRwPerformanceDate_(row);
      if (!clickDate || clickDate < startDate || clickDate > endDate) continue;

      const key = `${merchantId}|${clickDate}`;
      const existing = agg.get(key);
      if (existing) {
        existing.clicks += clicks;
      } else {
        agg.set(key, {
          merchantId,
          merchantName: String(row.merchant_name ?? row.advertiser_name ?? ''),
          clickDate,
          clicks,
        });
      }
    }

    if ([...agg.values()].reduce((s, r) => s + r.clicks, 0) > 0) {
      break;
    }
  }

  return Array.from(agg.values());
}

async function postRwClickDetailsPage(
  apiToken: string,
  beginDate: string,
  endDate: string,
  page: number,
) {
  await throttleRwClickRequest();

  const params: Record<string, string> = {
    token: apiToken,
    begin_date: beginDate,
    end_date: endDate,
    page: String(page),
    limit: String(RW_CLICK_PAGE_SIZE),
  };

  const { data } = await axios.post<unknown>(
    `${RW_API_BASE}?mod=medium&op=click_details`,
    new URLSearchParams(params).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
      maxContentLength: 8 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024,
    },
  );

  if (typeof data === 'string') {
    const msg = data.trim();
    if (/token error/i.test(msg)) {
      return { code: 1002, message: msg, rows: [] as unknown[], totalPages: null as number | null };
    }
    return { code: -1, message: msg, rows: [] as unknown[], totalPages: null as number | null };
  }

  const parsed = parseRwApiEnvelope(data);
  return {
    code: parsed.code === 0 ? 0 : parsed.code,
    message: parsed.message,
    rows: parsed.rows,
    totalPages: parsed.totalPages,
  };
}

function resolveRwClickMerchantId(row: Record<string, unknown> | RwClickRow): string {
  const rec = row as Record<string, unknown>;
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id'] as const) {
    const raw = rec[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  return '';
}

function parseRwClickDate_(clickTime: unknown): string {
  const s = String(clickTime ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function parseRwPerformanceDate_(row: Record<string, unknown>): string {
  for (const key of ['date', 'ymd', 'order_ymd', 'transaction_date', 'day'] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '') continue;
    const s = String(v).trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return '';
}

function parseRwClickCount_(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function listUtc8Dates_(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addUtc8Days_(cur, 1);
  }
  return out;
}

function addUtc8Days_(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function throttleRwClickRequest() {
  const now = Date.now();
  const wait = lastRwClickRequestAt + RW_CLICK_MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep(wait);
  }
  lastRwClickRequestAt = Date.now();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
