import { fetchLhPagedList, buildLhDailySlots } from './linkhaitao-api.util';
import { LhCommissionRow } from './linkhaitao.collector';

/** click-report-api 返回的单条点击 */
export interface LhClickRow {
  mid?: string | number;
  m_id?: string | number;
  mcid?: string | number;
  merchant_name?: string;
  tagcode?: string;
  tagcode2?: string;
  click_time?: string;
  click_ref?: string;
}

export interface LhMerchantClickAgg {
  merchantId: string;
  merchantName: string;
  clickDate: string;
  clicks: number;
}

export interface LhClickFetchProgress {
  dayIndex: number;
  totalDays: number;
  clicksSoFar: number;
}

/**
 * 从订单行建立 mcid/slug → 数字 m_id 映射（点击 API 常返回 slug）
 */
export function buildLhMcidToMidMap(rows: LhCommissionRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const numericId = row.m_id ?? row.mid;
    if (numericId == null) continue;
    const mid = String(numericId).trim();
    if (!/^\d+$/.test(mid)) continue;

    const slugCandidates = [row.mcid, row.tagcode, row.tagcode2];
    for (const slug of slugCandidates) {
      if (slug == null) continue;
      const s = String(slug).trim().toLowerCase();
      if (s && !/^\d+$/.test(s)) {
        map.set(s, mid);
      }
    }
    const name = row.advertiser_name ?? row.merchant_name;
    if (name) {
      const slug = String(name).replace(/\s+/g, '').toLowerCase();
      if (slug) map.set(slug, mid);
    }
  }
  return map;
}

/**
 * 点击行解析为与订单/广告系列一致的广告主数字 ID
 */
export function resolveLhClickMerchantId(
  row: LhClickRow,
  slugToMid: Map<string, string>,
): string {
  for (const raw of [row.m_id, row.mid, row.mcid]) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return s;
  }
  const slug = String(row.mcid ?? row.mid ?? row.tagcode ?? '')
    .trim()
    .toLowerCase();
  if (slug && slugToMid.has(slug)) {
    return slugToMid.get(slug)!;
  }
  return slug;
}

/**
 * 采集 LH 点击并按商家+日期汇总（见 click-report-api：op=user_click2）
 */
export async function fetchLinkHaitaoClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  slugToMid: Map<string, string> = new Map(),
  onProgress?: (p: LhClickFetchProgress) => void | Promise<void>,
): Promise<LhMerchantClickAgg[]> {
  const agg = new Map<string, LhMerchantClickAgg>();
  const seenRefs = new Set<string>();
  const slots = buildLhDailySlots(startDate, endDate);

  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i];
    const rows = await fetchLhPagedList<LhClickRow>(
      'user_click2',
      apiToken,
      slot.begin,
      slot.end,
      '点击报表',
      4000,
    );

    for (const row of rows) {
      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
      }

      const merchantId = resolveLhClickMerchantId(row, slugToMid);
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

    if (onProgress) {
      const clicksSoFar = [...agg.values()].reduce((s, r) => s + r.clicks, 0);
      await onProgress({ dayIndex: i + 1, totalDays: slots.length, clicksSoFar });
    }
  }

  return [...agg.values()];
}
