import { normalizeCampaignStatus } from '../common/campaign-status.util';
import { parseCampaignName } from '../common/campaign-name.util';

export interface ParsedAdDailyRow {
  date: string;
  customerId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  impressions: number;
  clicks: number;
  cost: number;
  campaignBudget: number;
  searchBudgetLostIs: number;
  searchRankLostIs: number;
  avgCpc: number;
  maxCpc: number;
  currency: string;
  affiliateAlias: string;
  merchantId: string;
}

/** Google 账户级日花费（与后台概览一致，含已移除系列历史花费） */
export interface ParsedAccountDailyRow {
  date: string;
  customerId: string;
  customerName: string;
  currency: string;
  cost: number;
  costMicros: number;
}

export const ACCOUNT_DAILY_COST_TAB = 'raw_daily_account_cost';
export const MONTHLY_ACCOUNT_COST_TAB = 'monthly_account_cost';

/** 无系列明细时的差额补记系列 ID */
export const ACCOUNT_GAP_CAMPAIGN_ID = '__account_gap__';

const HEADER_ALIASES: Record<string, string[]> = {
  date: ['date', '日期'],
  customerId: ['customer_id', 'customer id', '账户id', '账户ID', '账户Id'],
  campaignId: ['campaign_id', 'campaign id', '广告系列id'],
  campaignName: ['campaign_name', 'campaign name', 'campaign', '广告系列名', '广告系列'],
  campaignStatus: ['campaign_status', 'campaign status', '状态', '广告系列状态'],
  impressions: ['impressions', '展示次数', '展示数'],
  clicks: ['clicks', '点击次数', '点击数'],
  cost: ['cost', 'spend', '花费', '广告费', 'cost_usd'],
  costMicros: ['cost_micros', 'cost micros'],
  campaignBudget: [
    'campaign_budget',
    'campaign_budget_amount',
    'budget',
    '广告系列预算',
    '日预算',
  ],
  searchBudgetLostIs: [
    'search_budget_lost_is',
    'search_budget_lost_impression_share',
    'search lost is (budget)',
    'budget_lost_impression_share',
    '预算丢失展示份额',
    'is_bgt',
  ],
  searchRankLostIs: [
    'search_rank_lost_is',
    'search_rank_lost_impression_share',
    'search lost is (rank)',
    'rank_lost_impression_share',
    '评级丢失展示份额',
    'is_rnk',
  ],
  avgCpc: ['average_cpc', 'avg_cpc', 'avg. cpc', '平均cpc'],
  maxCpc: ['max_cpc', 'maximum_cpc', 'max. cpc', '最高cpc'],
  adGroupId: ['ad_group_id', 'ad group id'],
  adId: ['ad_id', 'ad id'],
  currency: ['currency', '货币'],
};

/**
 * 解析 Google Sheet CSV（徐版 raw_daily_report 或简版中文表头）
 */
export function parseAdSheetCsv(csvText: string): ParsedAdDailyRow[] {
  const lines = splitCsvLines(csvText.trim());
  if (lines.length < 2) return [];

  const headerRowIndex = findHeaderRowIndex(lines);
  if (headerRowIndex < 0) return [];

  const headers = lines[headerRowIndex].map(normalizeHeader);
  const columnIndex = buildColumnIndex(headers);
  if (columnIndex.date === undefined || columnIndex.campaignName === undefined) {
    return [];
  }

  const grouped = new Map<string, ParsedAdDailyRow>();
  /** 同系列同 day 汇总 cost_micros，与 Google Ads 后台一致（先加 micros 再换算） */
  const costMicrosByKey = new Map<string, number>();
  /** 广告级去重（Sheet 初始化续跑可能重复 append 同一 ad 行） */
  const adLevel = new Map<
    string,
    ParsedAdDailyRow & { costMicros: number }
  >();

  for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
    const cells = lines[i];
    if (!cells.length || cells.every((c) => !c.trim())) continue;

    const dateRaw = getCell(cells, columnIndex.date);
    const date = normalizeDate(dateRaw);
    if (!date) continue;

    const campaignName = getCell(cells, columnIndex.campaignName);
    if (!campaignName) continue;

    const customerId = getCell(cells, columnIndex.customerId) || 'unknown';
    const campaignId =
      getCell(cells, columnIndex.campaignId) ||
      hashCampaignKey(customerId, campaignName);
    const adGroupId = getCell(cells, columnIndex.adGroupId);
    const adId = getCell(cells, columnIndex.adId);

    const impressions = parseIntCell(getCell(cells, columnIndex.impressions));
    const clicks = parseIntCell(getCell(cells, columnIndex.clicks));
    const cost = parseMoney(getCell(cells, columnIndex.cost));
    const costMicros = parseIntCell(getCell(cells, columnIndex.costMicros));
    const campaignBudget = parseMoney(getCell(cells, columnIndex.campaignBudget));
    const searchBudgetLostIs = parsePercent(getCell(cells, columnIndex.searchBudgetLostIs));
    const searchRankLostIs = parsePercent(getCell(cells, columnIndex.searchRankLostIs));
    const avgCpc = parseMoney(getCell(cells, columnIndex.avgCpc));
    const maxCpc = parseMoney(getCell(cells, columnIndex.maxCpc));
    const currency = getCell(cells, columnIndex.currency) || 'USD';
    const campaignStatus = normalizeCampaignStatus(getCell(cells, columnIndex.campaignStatus));

    const parsed = parseCampaignName(campaignName);
    const adKey =
      adId || adGroupId
        ? `${date}|${customerId}|${campaignId}|${adGroupId}|${adId}`
        : `${date}|${customerId}|${campaignId}|${impressions}|${clicks}|${costMicros || cost}`;

    const existingAd = adLevel.get(adKey);
    if (existingAd) {
      if (
        existingAd.impressions === impressions &&
        existingAd.clicks === clicks &&
        existingAd.cost === cost &&
        existingAd.costMicros === costMicros
      ) {
        continue;
      }
    }

    if (existingAd) {
      const prevImpressions = existingAd.impressions;
      existingAd.impressions += impressions;
      existingAd.clicks += clicks;
      existingAd.cost += cost;
      existingAd.costMicros += costMicros;
      existingAd.campaignBudget = Math.max(existingAd.campaignBudget, campaignBudget);
      existingAd.searchBudgetLostIs = weightedIs(
        existingAd.searchBudgetLostIs,
        prevImpressions,
        searchBudgetLostIs,
        impressions,
      );
      existingAd.searchRankLostIs = weightedIs(
        existingAd.searchRankLostIs,
        prevImpressions,
        searchRankLostIs,
        impressions,
      );
      existingAd.maxCpc = Math.max(existingAd.maxCpc, maxCpc);
      if (campaignStatus) {
        existingAd.campaignStatus = campaignStatus;
      }
    } else {
      adLevel.set(adKey, {
        date,
        customerId,
        campaignId,
        campaignName,
        campaignStatus,
        impressions,
        clicks,
        cost,
        costMicros,
        campaignBudget,
        searchBudgetLostIs,
        searchRankLostIs,
        avgCpc: avgCpc || (clicks > 0 ? cost / clicks : 0),
        maxCpc,
        currency,
        affiliateAlias: parsed.affiliateAlias,
        merchantId: parsed.merchantId,
      });
    }
  }

  for (const ad of adLevel.values()) {
    const key = `${ad.date}|${ad.customerId}|${ad.campaignId}`;

    const existing = grouped.get(key);
    if (existing) {
      const prevImpressions = existing.impressions;
      existing.impressions += ad.impressions;
      existing.clicks += ad.clicks;
      existing.cost += ad.cost;
      if (ad.costMicros > 0) {
        costMicrosByKey.set(key, (costMicrosByKey.get(key) ?? 0) + ad.costMicros);
      }
      existing.campaignBudget = Math.max(existing.campaignBudget, ad.campaignBudget);
      existing.searchBudgetLostIs = weightedIs(
        existing.searchBudgetLostIs,
        prevImpressions,
        ad.searchBudgetLostIs,
        ad.impressions,
      );
      existing.searchRankLostIs = weightedIs(
        existing.searchRankLostIs,
        prevImpressions,
        ad.searchRankLostIs,
        ad.impressions,
      );
      existing.maxCpc = Math.max(existing.maxCpc, ad.maxCpc);
      if (!existing.avgCpc && ad.clicks > 0) {
        existing.avgCpc = ad.cost / ad.clicks;
      }
      if (ad.campaignStatus) {
        existing.campaignStatus = ad.campaignStatus;
      }
    } else {
      if (ad.costMicros > 0) {
        costMicrosByKey.set(key, ad.costMicros);
      }
      grouped.set(key, {
        date: ad.date,
        customerId: ad.customerId,
        campaignId: ad.campaignId,
        campaignName: ad.campaignName,
        campaignStatus: ad.campaignStatus,
        impressions: ad.impressions,
        clicks: ad.clicks,
        cost: ad.cost,
        campaignBudget: ad.campaignBudget,
        searchBudgetLostIs: ad.searchBudgetLostIs,
        searchRankLostIs: ad.searchRankLostIs,
        avgCpc: ad.avgCpc,
        maxCpc: ad.maxCpc,
        currency: ad.currency,
        affiliateAlias: ad.affiliateAlias,
        merchantId: ad.merchantId,
      });
    }
  }

  for (const row of grouped.values()) {
    const key = `${row.date}|${row.customerId}|${row.campaignId}`;
    const totalMicros = costMicrosByKey.get(key) ?? 0;
    if (totalMicros > 0) {
      row.cost = microsToCurrency(totalMicros);
      if (row.clicks > 0) {
        row.avgCpc = row.cost / row.clicks;
      }
    }
    row.customerId = formatCustomerId(row.customerId);
  }

  return [...grouped.values()];
}

/** 月汇总账户花费（旧版脚本通常有此表） */
export interface ParsedMonthlyAccountRow {
  month: string;
  startDate: string;
  endDate: string;
  customerId: string;
  customerName: string;
  currency: string;
  cost: number;
}

/**
 * 解析 raw_daily_account_cost（账户级日花费，与 Google 后台一致）
 */
export function parseAccountDailyCostCsv(csvText: string): ParsedAccountDailyRow[] {
  const lines = splitCsvLines(csvText.trim());
  if (lines.length < 2) return [];

  const headerRowIndex = findAccountDailyHeaderRowIndex(lines);
  if (headerRowIndex < 0) return [];

  const headers = lines[headerRowIndex].map(normalizeHeader);
  const dateIdx = headers.findIndex((h) => HEADER_ALIASES.date.includes(h));
  const customerIdIdx = headers.findIndex((h) => HEADER_ALIASES.customerId.includes(h));
  const customerNameIdx = headers.findIndex((h) =>
    ['customer_name', 'customer name', '账户名'].includes(h),
  );
  const costIdx = headers.findIndex((h) => HEADER_ALIASES.cost.includes(h));
  const costMicrosIdx = headers.findIndex((h) => HEADER_ALIASES.costMicros.includes(h));
  const currencyIdx = headers.findIndex((h) => HEADER_ALIASES.currency.includes(h));
  if (dateIdx < 0 || customerIdIdx < 0 || costIdx < 0) return [];

  const grouped = new Map<string, ParsedAccountDailyRow>();
  for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
    const cells = lines[i];
    if (!cells.length || cells.every((c) => !c.trim())) continue;

    const date = normalizeDate(getCell(cells, dateIdx));
    if (!date) continue;

    const customerId = formatCustomerId(getCell(cells, customerIdIdx) || 'unknown');
    const costMicros = parseIntCell(getCell(cells, costMicrosIdx));
    const costFromMicros = costMicros > 0 ? microsToCurrency(costMicros) : 0;
    const cost = costFromMicros || parseMoney(getCell(cells, costIdx));
    const key = `${date}|${customerId}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.costMicros += costMicros;
      existing.cost = existing.costMicros > 0
        ? microsToCurrency(existing.costMicros)
        : existing.cost + cost;
    } else {
      grouped.set(key, {
        date,
        customerId,
        customerName: getCell(cells, customerNameIdx),
        currency: getCell(cells, currencyIdx) || 'USD',
        cost: costFromMicros || cost,
        costMicros,
      });
    }
  }

  return [...grouped.values()];
}

/**
 * 用账户级日花费补齐明细与 Google 后台之间的差额（按系列花费比例分摊）
 * @param snapshotByCustomer 无系列明细时，优先写入当前 ENABLED 系列（而非差额补记行）
 */
export function applyAccountCostAdjustment(
  campaignRows: ParsedAdDailyRow[],
  accountRows: ParsedAccountDailyRow[],
  snapshotByCustomer?: Map<string, ParsedBudgetSnapshotRow>,
): { rows: ParsedAdDailyRow[]; adjustmentApplied: boolean; totalAdjustment: number } {
  if (!accountRows.length) {
    return { rows: campaignRows, adjustmentApplied: false, totalAdjustment: 0 };
  }

  const accountByKey = new Map<string, ParsedAccountDailyRow>();
  for (const row of accountRows) {
    const key = `${row.date}|${normalizeCustomerId(row.customerId)}`;
    accountByKey.set(key, row);
  }

  const groups = new Map<string, ParsedAdDailyRow[]>();
  for (const row of campaignRows) {
    if (row.campaignId === ACCOUNT_GAP_CAMPAIGN_ID) continue;
    const key = `${row.date}|${normalizeCustomerId(row.customerId)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const adjusted = campaignRows.filter((r) => r.campaignId !== ACCOUNT_GAP_CAMPAIGN_ID);
  let totalAdjustment = 0;
  let adjustmentApplied = false;

  for (const [key, accountRow] of accountByKey) {
    const accountCost = accountRow.costMicros > 0
      ? microsToCurrency(accountRow.costMicros)
      : accountRow.cost;
    const detailRows = groups.get(key) ?? [];
    const detailSum = detailRows.reduce((sum, r) => sum + r.cost, 0);
    const delta = Math.round((accountCost - detailSum) * 100) / 100;

    /** 仅向上补齐：账户表不完整时绝不压低明细花费 */
    if (delta < 0.005) continue;
    adjustmentApplied = true;
    totalAdjustment += delta;

    if (detailRows.length === 0) {
      if (accountCost <= 0) continue;
      const [date, customerId] = key.split('|');
      /** 无系列明细时不写入当前 ENABLED 系列，避免把账户费错挂到新系列（如 Sandro 6/7 花费挂到 6/23 新建系列） */
      adjusted.push({
        date,
        customerId: formatCustomerId(customerId),
        campaignId: ACCOUNT_GAP_CAMPAIGN_ID,
        campaignName: '[账户级差额补记]',
        campaignStatus: '',
        impressions: 0,
        clicks: 0,
        cost: accountCost,
        campaignBudget: 0,
        searchBudgetLostIs: 0,
        searchRankLostIs: 0,
        avgCpc: 0,
        maxCpc: 0,
        currency: accountRow.currency || 'USD',
        affiliateAlias: '',
        merchantId: '',
      });
      continue;
    }

    if (detailSum <= 0) continue;

    const ratio = accountCost / detailSum;
    for (const row of detailRows) {
      row.cost = Math.round(row.cost * ratio * 100) / 100;
      row.avgCpc = row.clicks > 0 ? row.cost / row.clicks : row.avgCpc;
    }

    const adjustedSum = detailRows.reduce((sum, r) => sum + r.cost, 0);
    const remainder = Math.round((accountCost - adjustedSum) * 100) / 100;
    if (Math.abs(remainder) >= 0.01) {
      const largest = detailRows.reduce((a, b) => (a.cost >= b.cost ? a : b));
      largest.cost = Math.round((largest.cost + remainder) * 100) / 100;
      largest.avgCpc = largest.clicks > 0 ? largest.cost / largest.clicks : largest.avgCpc;
    }
  }

  return {
    rows: adjusted,
    adjustmentApplied,
    totalAdjustment: Math.round(totalAdjustment * 100) / 100,
  };
}

/**
 * 解析 monthly_account_cost（旧版/新版脚本均有，用于无日账户表时的差额补齐）
 */
export function parseMonthlyAccountCostCsv(csvText: string): ParsedMonthlyAccountRow[] {
  const lines = splitCsvLines(csvText.trim());
  if (lines.length < 2) return [];

  let headerRowIndex = -1;
  for (let i = 0; i < Math.min(lines.length, 5); i += 1) {
    const normalized = lines[i].map(normalizeHeader);
    if (
      normalized.some((h) => h === 'month') &&
      normalized.some((h) => HEADER_ALIASES.customerId.includes(h)) &&
      normalized.some((h) => HEADER_ALIASES.cost.includes(h))
    ) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex < 0) return [];

  const headers = lines[headerRowIndex].map(normalizeHeader);
  const monthIdx = headers.findIndex((h) => h === 'month');
  const startIdx = headers.findIndex((h) => ['start_date', 'start date'].includes(h));
  const endIdx = headers.findIndex((h) => ['end_date', 'end date'].includes(h));
  const customerIdIdx = headers.findIndex((h) => HEADER_ALIASES.customerId.includes(h));
  const customerNameIdx = headers.findIndex((h) =>
    ['customer_name', 'customer name', '账户名'].includes(h),
  );
  const costIdx = headers.findIndex((h) => HEADER_ALIASES.cost.includes(h));
  const currencyIdx = headers.findIndex((h) => HEADER_ALIASES.currency.includes(h));
  if (monthIdx < 0 || customerIdIdx < 0 || costIdx < 0) return [];

  const rows: ParsedMonthlyAccountRow[] = [];
  for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
    const cells = lines[i];
    if (!cells.length || cells.every((c) => !c.trim())) continue;
    const month = getCell(cells, monthIdx);
    const startDate = normalizeDate(getCell(cells, startIdx));
    const endDate = normalizeDate(getCell(cells, endIdx));
    const customerId = formatCustomerId(getCell(cells, customerIdIdx) || 'unknown');
    const cost = parseMoney(getCell(cells, costIdx));
    if (!month || !customerId || cost <= 0) continue;
    rows.push({
      month,
      startDate: startDate || month,
      endDate: endDate || month,
      customerId,
      customerName: getCell(cells, customerNameIdx),
      currency: getCell(cells, currencyIdx) || 'USD',
      cost,
    });
  }
  return rows;
}

/**
 * 按查询区间对 monthly_account_cost 做天数比例折算并求和（与 Google 账户级花费口径一致）
 */
export function sumProratedMonthlyAccountCost(
  monthlyRows: ParsedMonthlyAccountRow[],
  importStart: string,
  importEnd: string,
): number {
  if (!monthlyRows.length || !importStart || !importEnd || importStart > importEnd) {
    return 0;
  }

  let total = 0;
  for (const monthRow of monthlyRows) {
    const windowStart =
      importStart > monthRow.startDate ? importStart : monthRow.startDate;
    const windowEnd = importEnd < monthRow.endDate ? importEnd : monthRow.endDate;
    if (windowStart > windowEnd) continue;

    const monthDays = countDaysInclusive(monthRow.startDate, monthRow.endDate);
    const overlapDays = countDaysInclusive(windowStart, windowEnd);
    if (monthDays <= 0 || overlapDays <= 0) continue;

    total += monthRow.cost * (overlapDays / monthDays);
  }

  return Math.round(total * 100) / 100;
}

/**
 * 用月汇总账户花费补齐明细（按导入区间在月内天数比例折算，仅作旧脚本兜底）
 */
export function applyMonthlyCostAdjustment(
  campaignRows: ParsedAdDailyRow[],
  monthlyRows: ParsedMonthlyAccountRow[],
  importStart?: string,
  importEnd?: string,
): { rows: ParsedAdDailyRow[]; adjustmentApplied: boolean; totalAdjustment: number } {
  if (!monthlyRows.length) {
    return { rows: campaignRows, adjustmentApplied: false, totalAdjustment: 0 };
  }

  let totalAdjustment = 0;
  let adjustmentApplied = false;
  const adjusted = campaignRows.filter((r) => r.campaignId !== ACCOUNT_GAP_CAMPAIGN_ID);

  for (const monthRow of monthlyRows) {
    const windowStart =
      importStart && importStart > monthRow.startDate ? importStart : monthRow.startDate;
    const windowEnd = importEnd && importEnd < monthRow.endDate ? importEnd : monthRow.endDate;
    if (windowStart > windowEnd) continue;

    const monthDays = countDaysInclusive(monthRow.startDate, monthRow.endDate);
    const overlapDays = countDaysInclusive(windowStart, windowEnd);
    if (monthDays <= 0 || overlapDays <= 0) continue;

    const targetCost = Math.round(monthRow.cost * (overlapDays / monthDays) * 100) / 100;
    const detailRows = adjusted.filter(
      (r) =>
        formatCustomerId(r.customerId) === monthRow.customerId &&
        r.date >= windowStart &&
        r.date <= windowEnd &&
        r.campaignId !== ACCOUNT_GAP_CAMPAIGN_ID,
    );
    const detailSum = detailRows.reduce((sum, r) => sum + r.cost, 0);
    const delta = Math.round((targetCost - detailSum) * 100) / 100;
    if (delta < 0.005) continue;

    adjustmentApplied = true;
    totalAdjustment += delta;

    if (detailRows.length === 0) {
      adjusted.push({
        date: windowEnd,
        customerId: monthRow.customerId,
        campaignId: ACCOUNT_GAP_CAMPAIGN_ID,
        campaignName: '[月汇总差额补记]',
        campaignStatus: '',
        impressions: 0,
        clicks: 0,
        cost: targetCost,
        campaignBudget: 0,
        searchBudgetLostIs: 0,
        searchRankLostIs: 0,
        avgCpc: 0,
        maxCpc: 0,
        currency: monthRow.currency || 'USD',
        affiliateAlias: '',
        merchantId: '',
      });
      continue;
    }

    if (detailSum <= 0) continue;
    const ratio = targetCost / detailSum;
    for (const row of detailRows) {
      row.cost = Math.round(row.cost * ratio * 100) / 100;
      row.avgCpc = row.clicks > 0 ? row.cost / row.clicks : row.avgCpc;
    }
  }

  return {
    rows: adjusted,
    adjustmentApplied,
    totalAdjustment: Math.round(totalAdjustment * 100) / 100,
  };
}

function countDaysInclusive(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return 0;
  return Math.floor((e.getTime() - s.getTime()) / 86400000) + 1;
}

function findAccountDailyHeaderRowIndex(lines: string[][]): number {
  for (let i = 0; i < Math.min(lines.length, 5); i += 1) {
    const normalized = lines[i].map(normalizeHeader);
    const hasDate = normalized.some((h) => HEADER_ALIASES.date.includes(h));
    const hasCustomer = normalized.some((h) => HEADER_ALIASES.customerId.includes(h));
    const hasCost = normalized.some((h) => HEADER_ALIASES.cost.includes(h));
    if (hasDate && hasCustomer && hasCost) return i;
  }
  return -1;
}

function normalizeCustomerId(raw: string): string {
  return raw.replace(/-/g, '').trim();
}

/** 统一为 xxx-xxx-xxxx，避免同一账户多种写法进库 */
function formatCustomerId(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw.replace(/-/g, '').trim() || 'unknown';
}

function findHeaderRowIndex(lines: string[][]): number {
  for (let i = 0; i < Math.min(lines.length, 5); i += 1) {
    const normalized = lines[i].map(normalizeHeader);
    const hasDate = normalized.some((h) => HEADER_ALIASES.date.includes(h));
    const hasCampaign =
      normalized.some((h) => HEADER_ALIASES.campaignName.includes(h)) ||
      normalized.some((h) => HEADER_ALIASES.campaignId.includes(h));
    if (hasDate && hasCampaign) return i;
  }
  return -1;
}

function buildColumnIndex(headers: string[]): Partial<Record<keyof typeof HEADER_ALIASES, number>> {
  const index: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) {
      index[field as keyof typeof HEADER_ALIASES] = idx;
    }
  }
  return index;
}

function normalizeHeader(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return '';
}

function getCell(cells: string[], index?: number): string {
  if (index === undefined || index < 0) return '';
  return (cells[index] ?? '').trim();
}

function parseIntCell(raw: string): number {
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseMoney(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[$,\s]/g, '').replace(/[^\d.-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 与 Google Ads 脚本 microsToCurrency_ 一致：先汇总 micros 再换算，避免分行四舍五入差 $0.01
 */
function microsToCurrency(micros: number): number {
  return Math.round(micros / 10000) / 100;
}

/** 统一存 0–100 的百分比 */
function parsePercent(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[%\s]/g, '');
  const n = parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1) return n * 100;
  return n;
}

function weightedIs(prev: number, prevWeight: number, next: number, nextWeight: number): number {
  const total = prevWeight + nextWeight;
  if (total <= 0) return next;
  return (prev * prevWeight + next * nextWeight) / total;
}

function hashCampaignKey(customerId: string, campaignName: string): string {
  let hash = 0;
  const s = `${customerId}|${campaignName}`;
  for (let i = 0; i < s.length; i += 1) {
    hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  }
  return String(hash);
}

function splitCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
      if (ch === '\r') i += 1;
    } else if (ch !== '\r') {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/**
 * 从 Sheet URL 提取 spreadsheetId
 */
export function extractSheetId(sheetUrl: string): string | null {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m?.[1] ?? null;
}

/**
 * 构建 Google Sheet CSV 导出地址
 */
export function buildSheetCsvUrl(sheetId: string, tabName: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tabName)}`;
}

/** Google 脚本 campaign_budget_snapshots 表名 */
export const BUDGET_SNAPSHOT_TAB = 'campaign_budget_snapshots';

/** 广告系列预算快照行（与 MCC 当前 ENABLED 系列对齐） */
export interface ParsedBudgetSnapshotRow {
  snapshotDate: string;
  customerId: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  campaignBudget: number;
}

/**
 * 解析 campaign_budget_snapshots CSV
 */
export function parseBudgetSnapshotCsv(csvText: string): ParsedBudgetSnapshotRow[] {
  const lines = splitCsvLines(csvText.trim());
  if (lines.length < 2) return [];

  const headers = lines[0].map(normalizeHeader);
  const dateIdx = headers.findIndex((h) =>
    ['snapshot_date', 'snapshot date', '日期'].includes(h),
  );
  const customerIdIdx = headers.findIndex((h) => HEADER_ALIASES.customerId.includes(h));
  const campaignIdIdx = headers.findIndex((h) => HEADER_ALIASES.campaignId.includes(h));
  const nameIdx = headers.findIndex((h) => HEADER_ALIASES.campaignName.includes(h));
  const statusIdx = headers.findIndex((h) => HEADER_ALIASES.campaignStatus.includes(h));
  const budgetIdx = headers.findIndex((h) => HEADER_ALIASES.campaignBudget.includes(h));
  if (dateIdx < 0 || customerIdIdx < 0 || campaignIdIdx < 0 || nameIdx < 0) return [];

  const out: ParsedBudgetSnapshotRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i];
    if (!cells.length || cells.every((c) => !c.trim())) continue;
    const snapshotDate = normalizeDate(getCell(cells, dateIdx));
    if (!snapshotDate) continue;
    const customerId = formatCustomerId(getCell(cells, customerIdIdx) || 'unknown');
    const campaignId = getCell(cells, campaignIdIdx).trim();
    const campaignName = getCell(cells, nameIdx).trim();
    if (!campaignId || !campaignName) continue;
    out.push({
      snapshotDate,
      customerId,
      campaignId,
      campaignName,
      campaignStatus: normalizeCampaignStatus(getCell(cells, statusIdx)),
      campaignBudget: parseMoney(getCell(cells, budgetIdx)),
    });
  }
  return out;
}

/**
 * 截至 endDate，每个子账号取最新 ENABLED 快照（对齐 Google MCC 系列列表）
 */
export function resolveEnabledCampaignsByCustomerFromSnapshots(
  rows: ParsedBudgetSnapshotRow[],
  endDate: string,
): Map<string, ParsedBudgetSnapshotRow> {
  const byCustomer = new Map<string, ParsedBudgetSnapshotRow>();
  for (const row of rows) {
    if (row.snapshotDate > endDate) continue;
    if (row.campaignStatus !== 'ENABLED') continue;
    const prev = byCustomer.get(row.customerId);
    if (!prev || row.snapshotDate >= prev.snapshotDate) {
      byCustomer.set(row.customerId, row);
    }
  }
  return byCustomer;
}
