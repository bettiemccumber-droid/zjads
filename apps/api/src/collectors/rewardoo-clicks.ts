import axios from 'axios';
import {
  forEachRewardooCommissionPage,
  forEachRewardooPerformancePage,
  parseRwApiEnvelope,
  RW_API_BASE,
  type RwCommissionOp,
  type RwPerformanceOp,
} from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  phase: 'commission' | 'click_details';
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

/** commission 汇总（payment_begin/end，与订单 commission 模块一致） */
const RW_CLICK_COMMISSION_OPS: RwCommissionOp[] = ['merchant', 'performance', 'report'];

/** performance 模块（begin/end，部分账号可用） */
const RW_CLICK_PERF_OPS: RwPerformanceOp[] = ['merchant', 'report', 'summary'];

/** ClickDetails：60 秒内最多 15 次（文档错误码 1006） */
const RW_CLICK_MIN_INTERVAL_MS = 4100;

const RW_CLICK_PAGE_SIZE = 500;

/** 单次采集最长自然日数 */
const RW_CLICK_MAX_DAYS = 62;

let lastRwClickRequestAt = 0;

/**
 * 采集 Rewardoo 联盟点击。
 * 优先 commission 商家日报 clicks（与后台 Performance 一致）；无数据时再回退 ClickDetails 小时片。
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
    await tryCommissionClickAgg_(
      apiToken,
      startDate,
      endDate,
      agg,
      onProgress,
    )
  ) {
    return Array.from(agg.values());
  }

  if (
    await tryPerformanceClickAgg_(
      apiToken,
      startDate,
      endDate,
      agg,
      onProgress,
    )
  ) {
    return Array.from(agg.values());
  }

  await fetchClickDetailsAggs_(apiToken, startDate, endDate, agg, onProgress);
  return Array.from(agg.values());
}

/** commission/payment_begin~end：与 RW 订单 commission 模块相同参数 */
async function tryCommissionClickAgg_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  for (const op of RW_CLICK_COMMISSION_OPS) {
    await forEachRewardooCommissionPage(
      op,
      apiToken,
      startDate,
      endDate,
      (rows) => {
        for (const raw of rows) {
          mergeCommissionClickRow_(raw as Record<string, unknown>, agg, startDate, endDate);
        }
      },
      RW_CLICK_PAGE_SIZE,
    );

    const clicksSoFar = sumAggClicks_(agg);
    if (onProgress) {
      await onProgress({
        phase: 'commission',
        slotIndex: 1,
        totalSlots: 1,
        clicksSoFar,
        source: `commission/${op}`,
      });
    }
    if (clicksSoFar > 0) return true;
  }

  const dates = listInclusiveDates_(startDate, endDate);
  for (const dateStr of dates) {
    for (const op of RW_CLICK_COMMISSION_OPS) {
      await forEachRewardooCommissionPage(
        op,
        apiToken,
        dateStr,
        dateStr,
        (rows) => {
          for (const raw of rows) {
            mergeCommissionClickRow_(
              raw as Record<string, unknown>,
              agg,
              startDate,
              endDate,
              dateStr,
            );
          }
        },
        RW_CLICK_PAGE_SIZE,
      );
      if (sumAggClicks_(agg) > 0) return true;
    }
  }

  return false;
}

/** performance/begin~end：对齐 RW 后台 Performance 交易日（失败则跳过） */
async function tryPerformanceClickAgg_(
  apiToken: string,
  startDate: string,
  endDate: string,
  agg: Map<string, RwMerchantClickAgg>,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<boolean> {
  for (const op of RW_CLICK_PERF_OPS) {
    try {
      await forEachRewardooPerformancePage(
        op,
        apiToken,
        startDate,
        endDate,
        (rows) => {
          for (const raw of rows) {
            mergeCommissionClickRow_(raw as Record<string, unknown>, agg, startDate, endDate);
          }
        },
        RW_CLICK_PAGE_SIZE,
      );
    } catch {
      continue;
    }

    const clicksSoFar = sumAggClicks_(agg);
    if (onProgress && clicksSoFar > 0) {
      await onProgress({
        phase: 'commission',
        slotIndex: 1,
        totalSlots: 1,
        clicksSoFar,
        source: `performance/${op}`,
      });
    }
    if (clicksSoFar > 0) return true;
  }

  return false;
}

/** commission 行：clicks 字段为当日汇总次数（非逐条点击） */
function mergeCommissionClickRow_(
  row: Record<string, unknown>,
  agg: Map<string, RwMerchantClickAgg>,
  startDate: string,
  endDate: string,
  defaultDate?: string,
): void {
  const merchantId = resolveRwClickMerchantId_(row);
  if (!merchantId) return;

  const clicks = parseRwClickCount_(
    row.clicks ?? row.click ?? row.total_clicks ?? row.click_count ?? row.cpc_click,
  );
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

/**
 * 官方 ClickDetails（mod=medium&op=click_details）小时片兜底。
 * 多数账号 Performance 有数但 click_details 为空，故仅作次级数据源。
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

/** 调用 ClickDetails 单页；首页不带 page/limit，避免部分站点返回空列表 */
async function postRwClickDetailsPage_(
  apiToken: string,
  beginDate: string,
  endDate: string,
  page: number,
) {
  await throttleRwClickRequest_();

  const params: Record<string, string> = {
    token: apiToken,
    begin_date: beginDate,
    end_date: endDate,
  };
  if (page > 1) {
    params.page = String(page);
    params.limit = String(RW_CLICK_PAGE_SIZE);
  }

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
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id', 'norm_id'] as const) {
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

function parseRwRowDate_(row: Record<string, unknown>): string {
  for (const key of [
    'date',
    'ymd',
    'order_ymd',
    'transaction_date',
    'payment_ymd',
    'day',
  ] as const) {
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
