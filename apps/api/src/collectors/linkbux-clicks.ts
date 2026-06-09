import { buildLbDailySlots, fetchLbClickDayFirstPage } from './linkbux-api.util';
import { LbTransactionRow } from './linkbux.collector';
import type { PmMerchantClickAgg } from './partnermatic-clicks';

/** Click API 返回字段（UTC+8） */
export interface LbClickRow {
  click_time?: string;
  click_ref?: string;
  mcid?: string | number;
  mid?: string | number;
  merchant_name?: string;
  uid?: string;
  uid2?: string;
}

export interface LbClickFetchProgress {
  slotIndex: number;
  totalSlots: number;
  clicksSoFar: number;
}

/** 伪商家 ID：未分配/未解析点击，不参与广告系列归因 */
export const LB_CLICK_PSEUDO_MERCHANT_PREFIX = '__lb_';

/**
 * 是否 LinkBux 采集占位商家（报表归因时排除）
 */
export function isLbClickPseudoMerchant(merchantId: string): boolean {
  return merchantId.startsWith(LB_CLICK_PSEUDO_MERCHANT_PREFIX);
}

export interface LbClickFetchResult {
  aggs: PmMerchantClickAgg[];
  /** 各日 total_items 之和，与 LB 后台 CPS Total Clicks 一致 */
  accountClickTotal: number;
  /** 首页样本不足、商家点击经估算的自然日数 */
  estimatedMerchantDays: number;
}

/** Click API 仅支持 2023-01-01 及以后 */
export const LB_CLICK_MIN_DATE = '2023-01-01';

/** 样本中商家点击占比超过此值时，视为当日主导商家（首页外仍有其点击，需按日放大） */
const LB_DOMINANT_MERCHANT_SHARE = 0.74;

/**
 * 从订单行建立 mcid/slug → 数字 mid（点击 API 常返回 slug）
 */
export function buildLbMcidToMidMap(rows: LbTransactionRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const numericId = row.mid;
    if (numericId == null) continue;
    const mid = String(numericId).trim();
    if (!/^\d+$/.test(mid)) continue;

    map.set(mid, mid);

    const name = row.merchant_name;
    if (name) {
      const nameSlug = String(name).replace(/\s+/g, '').toLowerCase();
      if (nameSlug) map.set(nameSlug, mid);
      const paren = String(name).match(/\((\d+)\)/);
      if (paren) map.set(paren[1], mid);
      const beatbotSlug = String(name).replace(/\[.*?\]/gi, '').replace(/\(\d+\)/, '').trim().replace(/\s+/g, '').toLowerCase();
      if (beatbotSlug) map.set(beatbotSlug, mid);
    }
  }
  return map;
}

/** LinkBux 推广链接 uid 约定：填写商家数字 MID（如 388783） */
export const LB_CLICK_UID_PATTERN = /^\d+$/;

/**
 * 从 LinkBux 自定义追踪 uid 解析商家数字 MID
 */
export function merchantIdFromLbUid(uid: string | undefined): string {
  if (!uid) return '';
  const s = String(uid).trim();
  if (LB_CLICK_UID_PATTERN.test(s)) return s;
  const prefixed = s.match(/^m(\d+)$/i);
  return prefixed ? prefixed[1] : '';
}

function midFromLbMerchantLabel(name: string | undefined): string {
  if (!name) return '';
  const paren = String(name).match(/\((\d+)\)/);
  return paren ? paren[1] : '';
}

/**
 * 点击行解析为与订单/广告系列一致的广告主数字 ID
 */
export function resolveLbClickMerchantId(
  row: LbClickRow,
  slugToMid: Map<string, string>,
): string {
  const fromUid = merchantIdFromLbUid(row.uid) || merchantIdFromLbUid(row.uid2);
  if (fromUid) return fromUid;

  for (const raw of [row.mid, row.mcid]) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) return s;
  }

  const fromName = midFromLbMerchantLabel(row.merchant_name);
  if (fromName) return fromName;

  const slug = String(row.mcid ?? row.mid ?? '')
    .trim()
    .toLowerCase();
  if (slug && slugToMid.has(slug)) {
    return slugToMid.get(slug)!;
  }
  return slug;
}

function clampClickStartDate(startDate: string): string {
  return startDate < LB_CLICK_MIN_DATE ? LB_CLICK_MIN_DATE : startDate;
}

/**
 * LinkBux 首页样本不足 total_items 时的商家点击分配。
 * 低占比商家（如 06-01 已完整收录）保持原值；主导商家按日总量放大；缺口计入未分配桶。
 */
export function allocateLbDayClickCounts(
  dayAggs: PmMerchantClickAgg[],
  totalItems: number,
  clickDate: string,
): void {
  if (totalItems <= 0) {
    dayAggs.length = 0;
    return;
  }

  const sampleTotal = dayAggs.reduce((s, r) => s + r.clicks, 0);
  if (sampleTotal <= 0) {
    dayAggs.push({
      merchantId: '__lb_unmatched__',
      merchantName: '未解析商家',
      clickDate,
      clicks: totalItems,
    });
    return;
  }

  if (totalItems <= sampleTotal) {
    return;
  }

  const dayScale = totalItems / sampleTotal;

  for (const row of dayAggs) {
    const share = row.clicks / sampleTotal;
    if (share >= LB_DOMINANT_MERCHANT_SHARE) {
      row.clicks = Math.round(row.clicks * dayScale);
    }
  }

  let assigned = dayAggs.reduce((s, r) => s + r.clicks, 0);
  const remainder = totalItems - assigned;
  if (remainder === 0) {
    return;
  }

  const unallocated = dayAggs.find((r) => r.merchantId === '__lb_unallocated__');
  if (unallocated) {
    unallocated.clicks += remainder;
    return;
  }

  dayAggs.push({
    merchantId: '__lb_unallocated__',
    merchantName: '未分配点击',
    clickDate,
    clicks: remainder,
  });
}

/**
 * 采集 LinkBux 点击（op=user_click，按自然日逐日请求）并按商家+自然日汇总。
 * 日常同步建议只传单日（startDate=endDate），该日 total_items≤2000 时商家明细精确。
 * @see https://www.linkbux.com/publisher/tools/api/click_api/
 */
/**
 * 从点击行补充 slug → mid（商家仅有联盟点击、区间内无订单时仍可对账）
 */
function enrichSlugToMidFromClickRow(row: LbClickRow, slugToMid: Map<string, string>): void {
  const fromName = midFromLbMerchantLabel(row.merchant_name);
  if (!fromName) return;
  const slug = String(row.mcid ?? row.mid ?? '')
    .trim()
    .toLowerCase();
  if (slug && !/^\d+$/.test(slug)) {
    slugToMid.set(slug, fromName);
  }
}

/**
 * 当日 API 返回 total_items 超过首页样本量时，商家点击为估算值
 */
export function isLbClickDayEstimated(totalItems: number, sampleRows: number): boolean {
  return totalItems > sampleRows && sampleRows >= 2000;
}

export async function fetchLinkBuxClicks(
  apiToken: string,
  startDate: string,
  endDate: string,
  slugToMid: Map<string, string> = new Map(),
  onProgress?: (p: LbClickFetchProgress) => void | Promise<void>,
): Promise<LbClickFetchResult> {
  const rangeStart = clampClickStartDate(startDate);
  const agg = new Map<string, PmMerchantClickAgg>();
  const slots = buildLbDailySlots(rangeStart, endDate);
  let accountClickTotal = 0;
  let estimatedMerchantDays = 0;

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
    const slot = slots[slotIndex];
    const { rows, totalItems } = await fetchLbClickDayFirstPage<LbClickRow>(
      apiToken,
      slot.begin,
      '点击报表',
    );
    accountClickTotal += totalItems;

    /** click_ref 仅在同一自然日槽内去重，避免跨天误删 */
    const seenRefs = new Set<string>();
    const dayMap = new Map<string, PmMerchantClickAgg>();

    for (const row of rows) {
      enrichSlugToMidFromClickRow(row, slugToMid);
    }

    for (const row of rows) {
      const ref = String(row.click_ref ?? '').trim();
      if (ref) {
        if (seenRefs.has(ref)) continue;
        seenRefs.add(ref);
      }

      const merchantId = resolveLbClickMerchantId(row, slugToMid);
      if (!merchantId) continue;

      /** 按 API 查询自然日归属（避免 click_time 时区导致跨日错位） */
      const clickDate = slot.begin;

      const key = `${merchantId}|${clickDate}`;
      const existing = dayMap.get(key);
      if (existing) {
        existing.clicks += 1;
      } else {
        dayMap.set(key, {
          merchantId,
          merchantName: String(row.merchant_name ?? ''),
          clickDate,
          clicks: 1,
        });
      }
    }

    const dayAggs = [...dayMap.values()];
    const sampleCount = dayAggs.reduce((s, r) => s + r.clicks, 0);
    if (isLbClickDayEstimated(totalItems, sampleCount)) {
      estimatedMerchantDays += 1;
    }
    allocateLbDayClickCounts(dayAggs, totalItems, slot.begin);

    for (const row of dayAggs) {
      const key = `${row.merchantId}|${row.clickDate}`;
      const existing = agg.get(key);
      if (existing) {
        existing.clicks += row.clicks;
      } else {
        agg.set(key, { ...row });
      }
    }

    if (onProgress) {
      await onProgress({
        slotIndex: slotIndex + 1,
        totalSlots: slots.length,
        clicksSoFar: accountClickTotal,
      });
    }
  }

  return { aggs: [...agg.values()], accountClickTotal, estimatedMerchantDays };
}
