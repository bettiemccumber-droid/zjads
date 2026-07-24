import axios from 'axios';

import { buildPmHourlySlots } from './partnermatic-clicks';

const UI_CLICK_API = 'https://api.ultrainfluence.com/api/click_report';

/** UI click_report 限速：10 req/min（1012） */
const UI_SLOT_INTERVAL_MS = 6500;

interface UiClickRow {
  click_time?: string;
  brand_id?: string | number;
  mid?: string | number;
  merchant_name?: string;
}

export interface UiMerchantClickAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  clicks: number;
}

export interface UiClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

/**
 * 采集 UI 点击并按商家+日期汇总（UTC+8 自然日）
 */
export async function fetchUltraInfluenceClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: UiClickFetchProgress) => void | Promise<void>,
): Promise<UiMerchantClickAgg[]> {
  const agg = new Map<string, UiMerchantClickAgg>();
  const slots = buildPmHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 100) {
      const response = await postUiClickPage(apiToken, slot.begin, slot.end, page);

      if (response.data?.code === '1012' || response.data?.code === '1002') {
        rateRetries += 1;
        if (rateRetries > 15) {
          throw new Error('UI click_report 频率限制，请稍后重试');
        }
        await sleep(7000);
        continue;
      }

      rateRetries = 0;

      if (response.data?.code !== '0') {
        throw new Error(response.data?.message ?? 'UltraInfluence click_report 错误');
      }

      const data = response.data.data ?? {};
      totalPages = Number(data.total_page ?? data.totalPage) || 1;
      const list = (data.list ?? []) as UiClickRow[];

      for (const row of list) {
        const merchantId = String(row.brand_id ?? row.mid ?? '').trim();
        if (!merchantId || merchantId === '0') continue;
        const clickDate = String(row.click_time ?? '').split(' ')[0];
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
      if (page <= totalPages) await sleep(7000);
    }

    const clicksSoFar = [...agg.values()].reduce((s, r) => s + r.clicks, 0);
    if (onProgress && (slotIndex === 0 || slotIndex % 6 === 0 || slotIndex === slots.length - 1)) {
      await onProgress({ slotIndex: slotIndex + 1, totalSlots: slots.length, clicksSoFar });
    }
    if (slotIndex < slots.length - 1) {
      await sleep(UI_SLOT_INTERVAL_MS);
    }
  }

  return Array.from(agg.values());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** UI click_report 单次请求 */
async function postUiClickPage(
  apiToken: string,
  beginDate: string,
  endDate: string,
  page: number,
  maxAttempts = 3,
) {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await axios.post(
        UI_CLICK_API,
        {
          source: 'ultrainfluence',
          token: apiToken,
          beginDate,
          endDate,
          curPage: page,
          perPage: 500,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
      );
    } catch (err) {
      lastErr = err;
      if (axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message)))) {
        if (attempt < maxAttempts) {
          await sleep(2000 * attempt);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastErr;
}
