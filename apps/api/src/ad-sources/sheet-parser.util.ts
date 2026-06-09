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
  }

  return [...grouped.values()];
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
