import axios from 'axios';

const PM_CLICK_API = 'https://api.partnermatic.com/api/click_report';

interface PmClickRow {
  click_time?: string;
  brand_id?: string | number;
  mid?: string | number;
  merchant_name?: string;
}

export interface PmMerchantClickAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  clicks: number;
}

export interface PmClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

/**
 * 生成 PM click_report 可用的小时片（每片 ≤1 小时）
 */
export function buildPmHourlySlots(startDate: string, endDate: string): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  const cur = new Date(`${startDate}T00:00:00`);
  const last = new Date(`${endDate}T00:00:00`);
  while (cur <= last) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const ymd = `${y}-${m}-${d}`;
    for (let h = 0; h < 24; h++) {
      const hh = String(h).padStart(2, '0');
      slots.push({
        begin: `${ymd} ${hh}:00:00`,
        end: `${ymd} ${hh}:59:59`,
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return slots;
}

/**
 * 采集 PM 点击并按商家+日期汇总（刷量/换链监控，不参与广告转化率）
 */
export async function fetchPartnerMaticClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (p: PmClickFetchProgress) => void | Promise<void>,
): Promise<PmMerchantClickAgg[]> {
  const agg = new Map<string, PmMerchantClickAgg>();
  const slots = buildPmHourlySlots(startDate, endDate);

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    let page = 1;
    let totalPages = 1;
    let rateRetries = 0;

    while (page <= totalPages && page <= 100) {
      const response = await axios.post(
        PM_CLICK_API,
        {
          source: 'partnermatic',
          token: apiToken,
          beginDate: slot.begin,
          endDate: slot.end,
          curPage: page,
          perPage: 500,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 60000 },
      );

      if (response.data?.code === '1002') {
        rateRetries += 1;
        if (rateRetries > 15) {
          throw new Error('PM click_report 频率限制，请稍后重试');
        }
        await sleep(3000);
        continue;
      }

      rateRetries = 0;

      if (response.data?.code !== '0') {
        throw new Error(response.data?.message ?? 'PartnerMatic click_report 错误');
      }

      const data = response.data.data ?? {};
      totalPages = Number(data.total_page) || 1;
      const list = (data.list ?? []) as PmClickRow[];

      for (const row of list) {
        const merchantId = String(row.brand_id ?? row.mid ?? '').trim();
        if (!merchantId) continue;
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
      if (page <= totalPages) await sleep(200);
    }

    const clicksSoFar = [...agg.values()].reduce((s, r) => s + r.clicks, 0);
    if (onProgress && (slotIndex === 0 || slotIndex % 6 === 0 || slotIndex === slots.length - 1)) {
      await onProgress({ slotIndex: slotIndex + 1, totalSlots: slots.length, clicksSoFar });
    }
    await sleep(80);
  }

  return Array.from(agg.values());
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
