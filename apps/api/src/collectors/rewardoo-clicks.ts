import { forEachRewardooPerformancePage, type RwPerformanceOp } from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

const RW_PERF_OPS: RwPerformanceOp[] = ['merchant', 'report'];
const RW_PERF_PAGE_SIZE = 500;
const RW_MAX_DAYS_PER_FETCH = 400;

/**
 * 采集 Rewardoo 联盟点击：仅 performance 商家日报 clicks 字段，按自然日 + offset 分页流式汇总。
 */
export async function fetchRewardooClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const dates = listUtc8Dates_(startDate, endDate);

  for (let dayIndex = 0; dayIndex < dates.length; dayIndex += 1) {
    const dateStr = dates[dayIndex];
    const clicksBeforeDay = sumAggClicks_(agg);

    await aggregatePerformanceClicksForDay_(apiToken, RW_PERF_OPS[0], dateStr, agg);

    if (sumAggClicks_(agg) === clicksBeforeDay) {
      await aggregatePerformanceClicksForDay_(apiToken, RW_PERF_OPS[1], dateStr, agg);
    }

    if (onProgress) {
      await onProgress({
        slotIndex: dayIndex + 1,
        totalSlots: dates.length,
        clicksSoFar: sumAggClicks_(agg),
      });
    }
  }

  return Array.from(agg.values());
}

/** 按单日 offset 分页拉 performance，只保留商家+日汇总 */
async function aggregatePerformanceClicksForDay_(
  apiToken: string,
  op: RwPerformanceOp,
  dateStr: string,
  agg: Map<string, RwMerchantClickAgg>,
): Promise<void> {
  await forEachRewardooPerformancePage(
    op,
    apiToken,
    dateStr,
    dateStr,
    (rows) => {
      for (const raw of rows) {
        mergeRwPerformanceClickRow_(raw as Record<string, unknown>, dateStr, agg);
      }
    },
    RW_PERF_PAGE_SIZE,
  );
}

function mergeRwPerformanceClickRow_(
  row: Record<string, unknown>,
  dateStr: string,
  agg: Map<string, RwMerchantClickAgg>,
): void {
  const merchantId = resolveRwClickMerchantId_(row);
  if (!merchantId) return;

  const clicks = parseRwClickCount_(row.clicks ?? row.click);
  if (clicks <= 0) return;

  const clickDate = parseRwPerformanceDate_(row) || dateStr;
  if (clickDate !== dateStr) return;

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

function resolveRwClickMerchantId_(row: Record<string, unknown>): string {
  for (const key of ['mid', 'm_id', 'merchant_id', 'brand_id'] as const) {
    const raw = row[key];
    if (raw == null || String(raw).trim() === '') continue;
    return String(raw).trim();
  }
  return '';
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

function sumAggClicks_(agg: Map<string, RwMerchantClickAgg>): number {
  let total = 0;
  for (const row of agg.values()) total += row.clicks;
  return total;
}

function listUtc8Dates_(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate && out.length < RW_MAX_DAYS_PER_FETCH) {
    out.push(cur);
    if (cur === endDate) break;
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

/** @deprecated 仅测试保留；生产不再使用 click_details */
export function buildRwClickHourlySlots(
  startDate: string,
  endDate: string,
): { begin: string; end: string }[] {
  return listUtc8Dates_(startDate, endDate).flatMap((ymd) =>
    Array.from({ length: 24 }, (_, h) => {
      const hh = String(h).padStart(2, '0');
      const end =
        h < 23 ? `${ymd} ${String(h + 1).padStart(2, '0')}:00:00` : `${ymd} 23:59:59`;
      return { begin: `${ymd} ${hh}:00:00`, end };
    }),
  );
}
