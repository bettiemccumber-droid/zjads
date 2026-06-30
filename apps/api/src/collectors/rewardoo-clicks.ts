import { postRewardooApi, type RwPerformanceOp } from './rewardoo-api.util';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

const RW_PERF_OPS: RwPerformanceOp[] = ['merchant', 'report'];
const RW_PERF_PAGE_SIZE = 500;

/**
 * 采集 Rewardoo 联盟点击：仅 performance 商家日报 clicks 字段，按自然日分页流式汇总（低内存）。
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

    for (const op of RW_PERF_OPS) {
      await aggregatePerformanceClicksForDay_(apiToken, op, dateStr, agg);
    }

    const clicksSoFar = sumAggClicks_(agg);
    if (onProgress) {
      await onProgress({
        slotIndex: dayIndex + 1,
        totalSlots: dates.length,
        clicksSoFar,
      });
    }
  }

  return Array.from(agg.values());
}

/** 按单日 + 分页拉 performance，只保留商家+日汇总，不缓存全量 rows */
async function aggregatePerformanceClicksForDay_(
  apiToken: string,
  op: RwPerformanceOp,
  dateStr: string,
  agg: Map<string, RwMerchantClickAgg>,
): Promise<void> {
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 200) {
    const parsed = await postRewardooApi('performance', op, {
      token: apiToken,
      begin: dateStr,
      end: dateStr,
      page: String(page),
      limit: String(RW_PERF_PAGE_SIZE),
    });

    if (parsed.code === 1002) {
      await sleep_(65000);
      continue;
    }

    if (parsed.code !== 0) {
      return;
    }

    totalPages = parsed.totalPages ?? 1;

    for (const raw of parsed.rows) {
      const row = raw as Record<string, unknown>;
      const merchantId = resolveRwClickMerchantId_(row);
      if (!merchantId) continue;

      const clicks = parseRwClickCount_(row.clicks ?? row.click);
      if (clicks <= 0) continue;

      const clickDate = parseRwPerformanceDate_(row) || dateStr;
      if (clickDate !== dateStr) continue;

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

    if (parsed.rows.length < RW_PERF_PAGE_SIZE) break;
    page += 1;
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

function sleep_(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
