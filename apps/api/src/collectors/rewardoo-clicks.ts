import axios from 'axios';
import { parseRwApiEnvelope, RW_API_BASE } from './rewardoo-api.util';
import { buildPmHourlySlots, type PmMerchantClickAgg } from './partnermatic-clicks';

export type RwMerchantClickAgg = PmMerchantClickAgg;

export interface RwClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

interface RwClickRow {
  mid?: string | number;
  merchant_name?: string;
  click_time?: string;
  click_ref?: string;
}

/** Rewardoo ClickDetails：60 秒内最多 15 次（文档错误码 1006） */
const RW_CLICK_MIN_INTERVAL_MS = 4100;

let lastRwClickRequestAt = 0;

/**
 * 采集 Rewardoo 联盟点击（mod=medium&op=click_details），按商家+自然日汇总。
 * 单次请求时间窗 ≤1 小时；与 PM 一样按小时切片。
 */
export async function fetchRewardooClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: RwClickFetchProgress) => void | Promise<void>,
): Promise<RwMerchantClickAgg[]> {
  const agg = new Map<string, RwMerchantClickAgg>();
  const seenRefs = new Set<string>();
  const slots = buildPmHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 100) {
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
        const merchantId = String(row.mid ?? '').trim();
        if (!merchantId) continue;

        const ref = String(row.click_ref ?? '').trim();
        if (ref) {
          if (seenRefs.has(ref)) continue;
          seenRefs.add(ref);
        }

        const clickDate = String(row.click_time ?? '').trim().split(/\s+/)[0];
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

    const clicksSoFar = [...agg.values()].reduce((s, r) => s + r.clicks, 0);
    if (onProgress && (slotIndex === 0 || slotIndex % 6 === 0 || slotIndex === slots.length - 1)) {
      await onProgress({ slotIndex: slotIndex + 1, totalSlots: slots.length, clicksSoFar });
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
  };
  if (page > 1) {
    params.page = String(page);
  }

  const { data } = await axios.post<unknown>(
    `${RW_API_BASE}?mod=medium&op=click_details`,
    new URLSearchParams(params).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 120000,
      validateStatus: () => true,
    },
  );

  if (typeof data === 'string') {
    const msg = data.trim();
    if (/token error/i.test(msg)) {
      return { code: 1002, message: msg, rows: [], totalPages: null as number | null };
    }
    return { code: -1, message: msg, rows: [], totalPages: null as number | null };
  }

  const parsed = parseRwApiEnvelope(data);
  return {
    code: parsed.code === 0 ? 0 : parsed.code,
    message: parsed.message,
    rows: parsed.rows,
    totalPages: parsed.totalPages,
  };
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
