import axios from 'axios';
import type { NetworkV2PaymentHalfTotals } from './network-v2-payment-details.util';

/** V2 Payment Summary 单行（与 PM/UI 后台 Payments Summary 一致） */
export interface NetworkV2PaymentSummaryRow {
  payment_id?: string | number;
  amount?: string | number;
  payment_amount?: string | number;
  total?: string | number;
  status?: string;
  request_date?: string;
  paid_date?: string | null;
  payment_date?: string | null;
  date?: string;
  create_date?: string;
}

export interface NetworkV2PaymentSummaryConfig {
  summaryUrl: string;
  source: string;
  networkLabel: string;
}

const throttleByHost = new Map<string, number>();
const MIN_REQUEST_INTERVAL_MS = 6500;

async function throttleSummaryRequest(hostKey: string) {
  const last = throttleByHost.get(hostKey) ?? 0;
  const now = Date.now();
  const wait = last + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  throttleByHost.set(hostKey, Date.now());
}

function parseMoney(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseYmdFlexible(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/) ?? s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

export function parseNetworkV2SummaryRequestDate(row: NetworkV2PaymentSummaryRow): string | null {
  for (const raw of [row.request_date, row.date, row.create_date]) {
    const ymd = parseYmdFlexible(raw);
    if (ymd) return ymd;
  }
  return null;
}

export function parseNetworkV2SummaryPaidDate(row: NetworkV2PaymentSummaryRow): string | null {
  for (const raw of [row.paid_date, row.payment_date]) {
    const ymd = parseYmdFlexible(raw);
    if (ymd) return ymd;
  }
  return null;
}

function assertV2SummarySuccess(body: unknown, networkLabel: string): void {
  const root = body as Record<string, unknown>;
  const code = root.code;
  if (code === 0 || code === '0') return;
  const msg = String(root.message ?? root.msg ?? `${networkLabel} API 错误`);
  throw new Error(`${msg} (code=${String(code)})`);
}

function extractSummaryList(body: unknown): NetworkV2PaymentSummaryRow[] {
  const root = body as Record<string, unknown>;
  const data = root.data as Record<string, unknown> | undefined;
  if (data && Array.isArray(data.list)) return data.list as NetworkV2PaymentSummaryRow[];
  if (Array.isArray(root.list)) return root.list as NetworkV2PaymentSummaryRow[];
  if (Array.isArray(root.data)) return root.data as NetworkV2PaymentSummaryRow[];
  return [];
}

async function fetchSummaryPage(
  config: NetworkV2PaymentSummaryConfig,
  token: string,
  body: Record<string, string | number>,
): Promise<NetworkV2PaymentSummaryRow[]> {
  await throttleSummaryRequest(config.summaryUrl);
  const all: NetworkV2PaymentSummaryRow[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 200) {
    const payload = {
      source: config.source,
      token: token.trim(),
      curPage: page,
      perPage: 2000,
      ...body,
    };

    const { data } = await axios.post(config.summaryUrl, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 120000,
      validateStatus: () => true,
    });

    assertV2SummarySuccess(data, config.networkLabel);
    const list = extractSummaryList(data);
    all.push(...list);

    const dataObj = (data as Record<string, unknown>).data as Record<string, unknown> | undefined;
    const totalItems = Number(dataObj?.total_items ?? list.length);
    const perPage = Number(dataObj?.limit ?? 2000) || 2000;
    totalPages = Math.max(1, Math.ceil(totalItems / perPage) || 1);
    if (!list.length || list.length < 2000) break;
    page += 1;
  }

  return all;
}

function dedupeSummaryKey(row: NetworkV2PaymentSummaryRow): string {
  if (row.payment_id != null && String(row.payment_id).trim()) {
    return String(row.payment_id);
  }
  return `${parseNetworkV2SummaryRequestDate(row) ?? ''}|${parseNetworkV2SummaryPaidDate(row) ?? ''}|${parseMoney(row.amount)}`;
}

/**
 * 拉取 Payment Summary（合并付款日 + 申请日区间，避免漏掉 Payment in Progress）
 */
export async function fetchNetworkV2PaymentSummaryForRange(
  config: NetworkV2PaymentSummaryConfig,
  token: string,
  rangeBegin: string,
  rangeEnd: string,
): Promise<NetworkV2PaymentSummaryRow[]> {
  const variants: Record<string, string>[] = [
    { paidDateBegin: rangeBegin, paidDateEnd: rangeEnd },
    { requestDateBegin: rangeBegin, requestDateEnd: rangeEnd },
    { paidDateBegin: '2000-01-01', paidDateEnd: rangeEnd },
  ];

  const merged = new Map<string, NetworkV2PaymentSummaryRow>();
  let lastError: Error | null = null;

  for (const body of variants) {
    try {
      const rows = await fetchSummaryPage(config, token, body);
      for (const row of rows) {
        merged.set(dedupeSummaryKey(row), row);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (merged.size === 0 && lastError) {
    throw lastError;
  }

  return [...merged.values()];
}

function isSummaryReceivableStatus(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes('pending') ||
    s.includes('progress') ||
    s.includes('processing') ||
    s === 'unpaid'
  );
}

function isSummaryActualStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'paid' || s === 'success' || s === 'successed' || s === 'completed';
}

/**
 * Payment Summary → 结算上下半月（对齐 Payment in Progress / Paid）
 */
export function aggregateNetworkV2PaymentSummaryForSettlement(
  rows: NetworkV2PaymentSummaryRow[],
  month: string,
): NetworkV2PaymentHalfTotals {
  const out: NetworkV2PaymentHalfTotals = {
    receivableH1: 0,
    receivableH2: 0,
    actualH1: 0,
    actualH2: 0,
  };

  for (const row of rows) {
    const status = String(row.status ?? '').trim();
    const amount =
      parseMoney(row.amount) || parseMoney(row.payment_amount) || parseMoney(row.total);
    if (amount <= 0) continue;

    if (isSummaryReceivableStatus(status)) {
      const dateStr = parseNetworkV2SummaryRequestDate(row);
      if (!dateStr || !dateStr.startsWith(`${month}-`)) continue;
      const day = Number(dateStr.slice(8, 10));
      if (day <= 15) out.receivableH1 += amount;
      else out.receivableH2 += amount;
      continue;
    }

    if (isSummaryActualStatus(status)) {
      const dateStr = parseNetworkV2SummaryPaidDate(row) ?? parseNetworkV2SummaryRequestDate(row);
      if (!dateStr || !dateStr.startsWith(`${month}-`)) continue;
      const day = Number(dateStr.slice(8, 10));
      if (day <= 15) out.actualH1 += amount;
      else out.actualH2 += amount;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  out.receivableH1 = round(out.receivableH1);
  out.receivableH2 = round(out.receivableH2);
  out.actualH1 = round(out.actualH1);
  out.actualH2 = round(out.actualH2);
  return out;
}

function sumHalfTotals(t: NetworkV2PaymentHalfTotals): number {
  return t.receivableH1 + t.receivableH2 + t.actualH1 + t.actualH2;
}

/**
 * 优先 Payment Summary，无数据时回退 Payment Detail 汇总
 */
export function resolveV2SummaryOrDetailSettlement(
  summaryRows: NetworkV2PaymentSummaryRow[],
  detailAgg: NetworkV2PaymentHalfTotals,
  month: string,
): {
  receivable: { usdH1: number; usdH2: number };
  actual: { usdH1: number; usdH2: number };
  hasSummary: boolean;
} {
  const fromSummary = aggregateNetworkV2PaymentSummaryForSettlement(summaryRows, month);
  const hasSummary = summaryRows.length > 0 || sumHalfTotals(fromSummary) > 0;
  if (hasSummary) {
    return {
      receivable: { usdH1: fromSummary.receivableH1, usdH2: fromSummary.receivableH2 },
      actual: { usdH1: fromSummary.actualH1, usdH2: fromSummary.actualH2 },
      hasSummary: true,
    };
  }
  return {
    receivable: { usdH1: detailAgg.receivableH1, usdH2: detailAgg.receivableH2 },
    actual: { usdH1: detailAgg.actualH1, usdH2: detailAgg.actualH2 },
    hasSummary: false,
  };
}
