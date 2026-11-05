/** LinkHaitao / Partnermatic 等同族 V2 Payment Detail 单行 */
export interface NetworkV2PaymentDetailRow {
  brand_id?: number | string;
  mcid?: string | null;
  amount?: string | number;
  validation_date?: string;
  type?: string;
  note?: string;
  settlement_id?: string;
  merchant_name?: string | null;
  payment_id?: string | number | null;
  paid_date?: string | null;
  sign_id?: string;
  date?: string;
}

export interface NetworkV2PaymentHalfTotals {
  receivableH1: number;
  receivableH2: number;
  actualH1: number;
  actualH2: number;
}

export function parseNetworkV2Money(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function parseNetworkV2Ymd(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

/**
 * 仅 paid_date 表示已实收。
 * LH 等后台 Payment History 的 payment_id 为佣金批次号，Withdrawal 为空仍属可提现应收。
 */
export function isNetworkV2PaidRow(row: NetworkV2PaymentDetailRow): boolean {
  return Boolean(parseNetworkV2Ymd(row.paid_date));
}

/**
 * 汇总为结算报表上下半月应收/实收（USD）
 *
 * - 未打款（无 paid_date，含 LH Available for withdrawal）→ 应收，按 validation_date / Date 落月/半月
 * - 已打款且 paid_date 在结算月内 → 实收，按 paid_date 落半月
 */
export function aggregateNetworkV2PaymentDetailsForSettlement(
  paidRows: NetworkV2PaymentDetailRow[],
  validationRows: NetworkV2PaymentDetailRow[],
  month: string,
): NetworkV2PaymentHalfTotals {
  const out: NetworkV2PaymentHalfTotals = {
    receivableH1: 0,
    receivableH2: 0,
    actualH1: 0,
    actualH2: 0,
  };

  for (const row of paidRows) {
    if (!isNetworkV2PaidRow(row)) continue;
    const paid = parseNetworkV2Ymd(row.paid_date);
    if (!paid || !paid.startsWith(`${month}-`)) continue;
    const comm = parseNetworkV2Money(row.amount);
    if (comm <= 0) continue;
    const day = Number(paid.slice(8, 10));
    if (day <= 15) out.actualH1 += comm;
    else out.actualH2 += comm;
  }

  const seenReceivable = new Set<string>();
  for (const row of validationRows) {
    if (isNetworkV2PaidRow(row)) continue;
    const settled = parseNetworkV2Ymd(row.validation_date) ?? parseNetworkV2Ymd(row.date);
    if (!settled || !settled.startsWith(`${month}-`)) continue;
    const comm = parseNetworkV2Money(row.amount);
    if (comm <= 0) continue;
    const dedupeKey =
      String(row.sign_id ?? '').trim() ||
      `${row.settlement_id ?? ''}|${settled}|${comm}`;
    if (seenReceivable.has(dedupeKey)) continue;
    seenReceivable.add(dedupeKey);
    const day = Number(settled.slice(8, 10));
    if (day <= 15) out.receivableH1 += comm;
    else out.receivableH2 += comm;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  out.receivableH1 = round(out.receivableH1);
  out.receivableH2 = round(out.receivableH2);
  out.actualH1 = round(out.actualH1);
  out.actualH2 = round(out.actualH2);
  return out;
}
