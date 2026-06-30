import axios from 'axios';
import { parseAffiliateOrderDateUtc } from '../common/affiliate-order-date.util';
import {
  forEachRewardooOffsetPage,
  forEachRewardooPageLimit,
  parseRwApiEnvelope,
  RW_API_BASE,
} from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  phase: 'summary' | 'user_click' | 'click_details';
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
  source?: string;
}

interface RwClickRow {
  mid?: string | number;
  m_id?: string | number;
  merchant_id?: string | number;
  merchant_name?: string;
  click_time?: string;
  click_ref?: string;
}

interface RwClickSourceSpec {
  label: string;
  mod: string;
  op: string;
  dateParams: (begin: string, end: string) => Record<string, string>;
  extra?: Record<string, string>;
}

/**
 * 与 LinkBux/RW 后台 Performance 对齐（medium/performance 优先，type=json + page/limit）
 */
const RW_CLICK_SUMMARY_SOURCES: RwClickSourceSpec[] = [
  {
    label: 'medium/performance',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e }),
  },
  {
    label: 'medium/performance CPS',
    mod: 'medium',
    op: 'performance',
    dateParams: (b, e) => ({ begin_date: b, end_date: e, offer_type: 'CPS' }),
  },
  {
    label: 'medium/cpc_performance',
    mod: 'medium',
    op: 'cpc_performance',
    dateParams: (b, e) => ({
      begin_date: b,
      end_date: e,
      dimension: 'day',
      sub_dimension: 'merchant',
    }),
  },
  {
    label: 'commission/merchant',
    mod: 'commission',
    op: 'merchant',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/performance',
    mod: 'commission',
    op: 'performance',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/report',
    mod: 'commission',
    op: 'report',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'commission/cpc_performance',
    mod: 'commission',
    op: 'cpc_performance',
    dateParams: (b, e) => ({ payment_begin: b, payment_end: e }),
  },
  {
    label: 'performance/merchant',
    mod: 'performance',
    op: 'merchant',
    dateParams: (b, e) => ({ begin: b, end: e }),
  },
  {
    label: 'performance/report',
    mod: 'performance',
    op: 'report',
    dateParams: (b, e) => ({ begin: b, end: e }),
  },
];

/** ClickDetails：60 秒内最多 15 次（文档错误码 1006） */
const RW_CLICK_MIN_INTERVAL_MS = 4100;

const RW_CLICK_PAGE_SIZE = 500;

/** 单次采集最长自然日数 */
const RW_CLICK_MAX_DAYS = 62;

/** 超过此天数不再跑 click_details（168 小时片太慢且多数账号为空） */
const RW_CLICK_DETAILS_MAX_DAYS = 1;

let lastRwClickRequestAt = 0;

/**
 * 采集 Rewardoo 联盟点击。
 * 优先 Performance 汇总接口（page/limit）；仅单日区间才兜底 ClickDetails。
 */
export async function fetchRewardooClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const dayCount = countInclusiveDays_(startDate, endDate);
  if (dayCount > RW_CLICK_MAX_DAYS) {
    throw new Error(
      `RW 点击采集区间过长（${dayCount} 天），请缩短至 ${RW_CLICK_MAX_DAYS} 天内`,
    );
  }

  const agg = new Map<string, RwMerchantClickAgg>();

  if (
    await trySummarizedClickSources_(
      apiToken,
      startDate,
      endDate,
      agg,
      onProgress,
    )
  ) {
    return Array.from(agg.values());
  }

  if (await fetchRwUserClickAggs_(apiToken, startDate, endDate, agg, onProgress)) {
    return Array.from(agg.values());
  }

  if (dayCount <= RW_CLICK_DETAILS_MAX_DAYS) {
    await fetchClickDetailsAggs_(apiToken, startDate, endDate, agg, onProgress);
  }

  return Array.from(agg.values());
}

/** 尝试各汇总数据源：先整段，再按日；每种先试 page/limit，再试 offset */
async function trySummarizedClickSources_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  for (let i = 0; i < RW_CLICK_SUMMARY_SOURCES.length; i += 1) {
    const spec = RW_CLICK_SUMMARY_SOURCES[i];
    if (
      await fetchClickSource_(spec, apiToken, startDate, endDate, agg, startDate, endDate)
    ) {
      if (onProgress) {
        await onProgress({
          phase: 'summary',
          slotIndex: i + 1,
          totalSlots: RW_CLICK_SUMMARY_SOURCES.length,
          clicksSoFar: sumAggClicks_(agg),
          source: spec.label,
        });
      }
      return true;
    }
  }

  const dates = listInclusiveDates_(startDate, endDate);
  for (const dateStr of dates) {
    for (const spec of RW_CLICK_SUMMARY_SOURCES) {
      if (
        await fetchClickSource_(
          spec,
          apiToken,
          dateStr,
          dateStr,
          agg,
          startDate,
          endDate,
          dateStr,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

async function fetchClickSource_(
  spec: RwClickSourceSpec,
  apiToken: string,
  rangeBegin: string,
  rangeEnd: string,
  agg: Map<string, RwMerchantClickAgg>,
  filterStart: string,
  filterEnd: string,
  defaultDate?: string,
): Promise<boolean> {
  const extraParams = { ...(spec.extra ?? {}), ...spec.dateParams(rangeBegin, rangeEnd) };

  const merge = (rows: unknown[]) => {
    for (const raw of rows) {
      mergeSummaryClickRow_(
        raw as Record<string, unknown>,
        agg,
        filterStart,
        filterEnd,
        defaultDate,
      );
    }
  };

  try {
    const pageResult = await forEachRewardooPageLimit(
      spec.mod,
      spec.op,
      apiToken,
      extraParams,
      merge,
      RW_CLICK_PAGE_SIZE,
    );
    if (!pageResult.skipped && sumAggClicks_(agg) > 0) return true;

    if (pageResult.rowCount === 0 || sumAggClicks_(agg) === 0) {
      const offsetResult = await forEachRewardooOffsetPage(
        spec.mod,
        spec.op,
        apiToken,
        extraParams,
        merge,
        RW_CLICK_PAGE_SIZE,
      );
      if (!offsetResult.skipped && sumAggClicks_(agg) > 0) return true;
    }

    if (spec.mod === 'medium' && sumAggClicks_(agg) === 0) {
      if (await fetchMediumPerformanceViaGet_(spec, apiToken, extraParams, merge)) {
        return sumAggClicks_(agg) > 0;
      }
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * LinkBux 系 user_click：按自然日 GET，单日 total_items 与后台 CPS Total Clicks 一致。
 */
async function fetchRwUserClickAggs_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  const dates = listInclusiveDates_(startDate, endDate);
  let hadAnyResponse = false;

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const day = dates[dayIndex];
    const dayResult = await fetchRwUserClickDay_(apiToken, day);
    if (dayResult.skipped) continue;
    hadAnyResponse = true;

    const seenRefs = new Set<string>();
    for (const raw of dayResult.rows) {
      const row = raw as RwClickRow;
      const merchantId = resolveRwClickMerchantId_(row);
      if (!merchantId) continue;

      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
      }

      const aggKey = `${merchantId}|${day}`;
      const existing = agg.get(aggKey);
      if (existing) {
        existing.clicks += 1;
      } else {
        agg.set(aggKey, {
          merchantId,
          merchantName: String(row.merchant_name ?? ''),
          clickDate: day,
          clicks: 1,
        });
      }
    }

    /** 首页样本不足时，用 total_items 补全当日未分配点击（与 LB 一致） */
    if (dayResult.totalItems > sumAggClicksForDay_(agg, day)) {
      allocateRwDayClickGap_(agg, day, dayResult.totalItems);
    }

    if (onProgress && (dayIndex === 0 || dayIndex === dates.length - 1)) {
      await onProgress({
        phase: 'user_click',
        slotIndex: dayIndex + 1,
        totalSlots: dates.length,
        clicksSoFar: sumAggClicks_(agg),
        source: 'medium/user_click',
      });
    }
  }

  return hadAnyResponse && sumAggClicks_(agg) > 0;
}

async function fetchRwUserClickDay_(
  apiToken: string,
  day: string,
): Promise<{
  skipped: boolean;
  rows: unknown[];
  totalItems: number;
}> {
  await throttleRwClickRequest_();

  try {
    const { data } = await axios.get<unknown>(RW_API_BASE, {
      params: {
        mod: 'medium',
        op: 'user_click',
        token: apiToken,
        begin_date: day,
        end_date: day,
        type: 'json',
        page: '1',
        limit: String(RW_CLICK_PAGE_SIZE),
      },
      timeout: 120000,
      validateStatus: () => true,
    });

    const parsed = parseRwApiEnvelope(data);
    if (parsed.code === 1003 || parsed.code === 1004) {
      return { skipped: true, rows: [], totalItems: 0 };
    }
    if (parsed.code !== 0) {
      return { skipped: true, rows: [], totalItems: 0 };
    }

    const totalItems = extractRwTotalItems_(data, parsed.rows.length);
    return {
      skipped: false,
      rows: parsed.rows,
      totalItems: totalItems > 0 ? totalItems : parsed.rows.length,
    };
  } catch {
    return { skipped: true, rows: [], totalItems: 0 };
  }
}

function extractRwTotalItems_(body: unknown, listLen: number): number {
  const root = body as Record<string, unknown>;
  const payload = (root.payliad ?? root.payload ?? root.data ?? root) as Record<string, unknown>;
  const total = (payload.total ?? payload) as Record<string, unknown>;
  const n = Number(
    total.total_items ?? payload.total_items ?? root.total_items ?? 0,
  );
  return Number.isFinite(n) && n > 0 ? n : listLen;
}

function sumAggClicksForDay_(agg: Map<string, RwMerchantClickAgg>, day: string): number {
  let total = 0;
  for (const row of agg.values()) {
    if (row.clickDate === day) total += row.clicks;
  }
  return total;
}

/** 当日 user_click 首页样本不足 total_items 时，将缺口计入未解析商家桶 */
function allocateRwDayClickGap_(
  agg: Map<string, RwMerchantClickAgg>,
  day: string,
  totalItems: number,
): void {
  const sampleTotal = sumAggClicksForDay_(agg, day);
  if (totalItems <= sampleTotal) return;

  const gap = totalItems - sampleTotal;
  const key = `__rw_unmatched__|${day}`;
  const existing = agg.get(key);
  if (existing) {
    existing.clicks += gap;
  } else {
    agg.set(key, {
      merchantId: '__rw_unmatched__',
      merchantName: '未解析商家',
      clickDate: day,
      clicks: gap,
    });
  }
}

/** LinkBux 系 performance 部分站点仅支持 GET + query（与 POST 等价参数） */
async function fetchMediumPerformanceViaGet_(
  spec: RwClickSourceSpec,
  apiToken: string,
  extraParams: Record<string, string>,
  merge: (rows: unknown[]) => void,
): Promise<boolean> {
  try {
    await throttleRwClickRequest_();
    const { data } = await axios.get<unknown>(RW_API_BASE, {
      params: {
        mod: spec.mod,
        op: spec.op,
        token: apiToken,
        type: 'json',
        page: '1',
        limit: String(RW_CLICK_PAGE_SIZE),
        ...extraParams,
      },
      timeout: 120000,
      validateStatus: () => true,
    });
    const parsed = parseRwApiEnvelope(data);
    if (parsed.code !== 0 || !parsed.rows.length) return false;
    merge(parsed.rows);
    return true;
  } catch {
    return false;
  }
}

/** 汇总行：clicks 字段为当日次数（非逐条点击） */
function mergeSummaryClickRow_(
  row: Record<string, unknown>,
  agg: Map<string, RwMerchantClickAgg>,
  startDate: string,
  endDate: string,
  defaultDate?: string,
): void {
  const merchantId = resolveRwClickMerchantId_(row);
  if (!merchantId) return;

  const clicks = extractRwClickCountFromRow_(row);
  if (clicks <= 0) return;

  const clickDate = parseRwRowDate_(row) || defaultDate || '';
  if (!clickDate || clickDate < startDate || clickDate > endDate) return;

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

function extractRwClickCountFromRow_(row: Record<string, unknown>): number {
  for (const [key, val] of Object.entries(row)) {
    if (!/click/i.test(key)) continue;
    if (/click_(time|ref|id|url|link)|clicktime|clickdate/i.test(key)) continue;
    const n = parseRwClickCount_(val);
    if (n > 0) return n;
  }

  for (const nestedKey of ['stat', 'stats', 'summary', 'total'] as const) {
    const nested = row[nestedKey];
    if (!nested || typeof nested !== 'object') continue;
    const n = extractRwClickCountFromRow_(nested as Record<string, unknown>);
    if (n > 0) return n;
  }

  return 0;
}

/**
 * 官方 ClickDetails（mod=medium&op=click_details）小时片兜底（仅 ≤1 天区间）。
 */
async function fetchClickDetailsAggs_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<void> {
  const slots = buildRwClickHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const slotSeenRefs = new Set<string>();
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 100) {
      const parsed = await postRwClickDetailsPage_(
        apiToken,
        slot.begin,
        slot.end,
        page,
      );

      if (parsed.code === 1006) {
        rateRetries += 1;
        if (rateRetries > 15) {
          throw new Error('Rewardoo click_details 频率限制（1006），请稍后重试');
        }
        await sleep_(65000);
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
        const merchantId = resolveRwClickMerchantId_(row);
        if (!merchantId) continue;

        const ref = String(row.click_ref ?? '').trim();
        if (ref) {
          if (slotSeenRefs.has(ref)) continue;
          slotSeenRefs.add(ref);
        }

        const clickDate =
          parseRwClickDate_(row.click_time) || slot.begin.slice(0, 10);
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

      if (list.length < RW_CLICK_PAGE_SIZE) break;
      page += 1;
      if (page <= totalPages) await sleep_(200);
    }

    if (
      onProgress &&
      (slotIndex === 0 || slotIndex % 12 === 0 || slotIndex === slots.length - 1)
    ) {
      await onProgress({
        phase: 'click_details',
        slotIndex: slotIndex + 1,
        totalSlots: slots.length,
        clicksSoFar: sumAggClicks_(agg),
        source: 'medium/click_details',
      });
    }
  }
}

/**
 * 生成 RW click_details 小时片（UTC+8 日历日 + 整点窗口，与官方 curl 示例一致）。
 */
export function buildRwClickHourlySlots(
  startDate: string,
  endDate: string,
): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const dates = listInclusiveDates_(startDate, endDate);

  for (const ymd of dates) {
    for (let h = 0; h < 24; h += 1) {
      const hh = String(h).padStart(2, '0');
      const begin = `${ymd} ${hh}:00:00`;
      const end =
        h < 23
          ? `${ymd} ${String(h + 1).padStart(2, '0')}:00:00`
          : `${addCalendarDays_(ymd, 1)} 00:00:00`;
      slots.push({ begin, end });
    }
  }

  return slots;
}

/** 调用 ClickDetails 单页（始终带 page/limit，与 transaction_details 一致） */
async function postRwClickDetailsPage_(
  apiToken: string,
  beginDate: string,
  endDate: string,
  page: number,
) {
  await throttleRwClickRequest_();

  const params: Record<string, string> = {
    token: apiToken,
    type: 'json',
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
      maxContentLength: 16 * 1024 * 1024,
      maxBodyLength: 16 * 1024 * 1024,
    },
  );

  if (typeof data === 'string') {
    const msg = data.trim();
    if (/token error/i.test(msg)) {
      return {
        code: 1002,
        message: msg,
        rows: [] as unknown[],
        totalPages: null as number | null,
      };
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

function resolveRwClickMerchantId_(row: RwClickRow | Record<string, unknown>): string {
  const rec = row as Record<string, unknown>;
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'norm_id', 'mcid'] as const) {
    const raw = rec[key];
    if (raw == null || String(raw).trim() === '') continue;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return s;
  }

  const name = rec.merchant_name ?? rec.advertiser_name;
  if (name) {
    const paren = String(name).match(/\((\d+)\)/);
    if (paren) return paren[1];
  }

  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'mcid'] as const) {
    const raw = rec[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  return '';
}

function parseRwClickDate_(clickTime: unknown): string {
  const raw = clickTime;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 1_000_000_000) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : '';
}

function parseRwRowDate_(row: Record<string, unknown>): string {
  for (const key of [
    'transaction_date',
    'order_ymd',
    'order_date',
    'date',
    'ymd',
    'payment_ymd',
    'stat_date',
    'click_ymd',
    'day',
    'report_date',
  ] as const) {
    const v = row[key];
    if (v == null || String(v).trim() === '' || String(v) === 'null') continue;
    const s = String(v).trim();
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    try {
      if (typeof v === 'object') continue;
      return parseAffiliateOrderDateUtc(v as string | number).toISOString().slice(0, 10);
    } catch {
      continue;
    }
  }
  return '';
}

function parseRwClickCount_(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function sumAggClicks_(agg: Map<string, RwMerchantClickAgg>): number {
  let total = 0;
  for (const row of agg.values()) total += row.clicks;
  return total;
}

function listInclusiveDates_(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    if (cur === endDate) break;
    cur = addCalendarDays_(cur, 1);
  }
  return out;
}

function countInclusiveDays_(startDate: string, endDate: string): number {
  return listInclusiveDates_(startDate, endDate).length;
}

function addCalendarDays_(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

async function throttleRwClickRequest_() {
  const now = Date.now();
  const wait = lastRwClickRequestAt + RW_CLICK_MIN_INTERVAL_MS - now;
  if (wait > 0) {
    await sleep_(wait);
  }
  lastRwClickRequestAt = Date.now();
}

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
