import { postRewardooApi } from './rewardoo-api.util';

/** Rewardoo Payments API 单行（mod=commission&op=payments） */
export interface RewardooPaymentRow {
  withdrawal_id?: string | number;
  withdrawal_time?: string;
  withdrawal_amount?: string | number;
  commission?: string | number;
  amount?: string | number;
  advertising_fee?: string | number;
  other_revenue?: string | number;
  status?: string;
  account_balance?: string | number;
  update_time?: string;
  request_date?: string;
  paid_date?: string;
  payment_date?: string;
  withdrawal_account?: string;
  bank_name?: string;
  recipient?: string;
}

export interface RewardooPaymentHalfTotals {
  receivableH1: number;
  receivableH2: number;
  actualH1: number;
  actualH2: number;
}

function parseMoney(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseYmdFlexible(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * 解析申请/在途日期（对齐后台 Request Date、Payment in Progress 更新时间）
 */
export function parseRewardooRequestDate(row: RewardooPaymentRow): string | null {
  for (const raw of [row.request_date, row.withdrawal_time, row.update_time]) {
    const ymd = parseYmdFlexible(raw);
    if (ymd) return ymd;
  }
  return null;
}

/**
 * 解析实付日期（对齐后台 Paid Date）
 */
export function parseRewardooPaidDate(row: RewardooPaymentRow): string | null {
  for (const raw of [row.paid_date, row.payment_date, row.withdrawal_time, row.update_time]) {
    const ymd = parseYmdFlexible(raw);
    if (ymd) return ymd;
  }
  return null;
}

/** @deprecated 使用 parseRewardooRequestDate / parseRewardooPaidDate */
export function parseRewardooPaymentDate(row: RewardooPaymentRow): string | null {
  return parseRewardooRequestDate(row) ?? parseRewardooPaidDate(row);
}

function isRewardooReceivableStatus(status: string): boolean {
  return (
    status === 'processing' ||
    status.includes('pending') ||
    status.includes('progress') ||
    status === 'unpaid'
  );
}

function isRewardooActualStatus(status: string): boolean {
  return status === 'withdrawn' || status === 'paid' || status === 'success' || status === 'successed';
}

function dedupeKey(row: RewardooPaymentRow): string {
  if (row.withdrawal_id != null && String(row.withdrawal_id).trim()) {
    return String(row.withdrawal_id);
  }
  return `${parseRewardooRequestDate(row) ?? ''}|${parseRewardooPaidDate(row) ?? ''}|${parseMoney(row.commission)}`;
}

/** 后台顶栏 Payment in Progress 等汇总字段 */
const RW_IN_PROGRESS_AMOUNT_KEYS = [
  'payment_in_progress',
  'paymentInProgress',
  'processing_amount',
  'withdraw_processing',
  'payment_processing',
  'in_progress_amount',
] as const;

/**
 * 将 API 行或 summary 对象规范为 PaymentRow（含顶栏在途金额）
 */
export function coerceRewardooPaymentRows(rows: unknown[]): RewardooPaymentRow[] {
  const out: RewardooPaymentRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    if (
      r.withdrawal_id != null ||
      r.status != null ||
      r.commission != null ||
      r.request_date != null ||
      r.withdrawal_amount != null
    ) {
      out.push(raw as RewardooPaymentRow);
      continue;
    }
    for (const key of RW_IN_PROGRESS_AMOUNT_KEYS) {
      const amt = parseMoney(r[key]);
      if (amt > 0) {
        out.push({
          status: 'processing',
          commission: amt,
          update_time: String(
            r.last_update ?? r.last_updated ?? r.update_time ?? r.updated_at ?? '',
          ),
          request_date: String(r.request_date ?? r.request_time ?? ''),
        });
        break;
      }
    }
  }
  return out;
}

async function fetchRewardooPaymentsOnce(
  apiToken: string,
  dateParams: Record<string, string>,
): Promise<RewardooPaymentRow[]> {
  const parsed = await postRewardooApi('commission', 'payments', {
    token: apiToken.trim(),
    ...dateParams,
  });
  if (parsed.code !== 0) {
    throw new Error(parsed.message || `Rewardoo Payments API 错误 code=${parsed.code}`);
  }
  return coerceRewardooPaymentRows(parsed.rows);
}

/**
 * 拉取 Rewardoo 打款记录（合并付款日 + 申请日区间，避免漏掉 Payment in Progress）
 */
export async function fetchRewardooPayments(
  apiToken: string,
  rangeBegin: string,
  rangeEnd: string,
): Promise<RewardooPaymentRow[]> {
  const variants: Record<string, string>[] = [
    { request_begin: rangeBegin, request_end: rangeEnd },
    { payment_begin: rangeBegin, payment_end: rangeEnd },
    { withdrawal_begin: rangeBegin, withdrawal_end: rangeEnd },
    { update_begin: rangeBegin, update_end: rangeEnd },
    { create_begin: rangeBegin, create_end: rangeEnd },
    {},
  ];

  const merged = new Map<string, RewardooPaymentRow>();
  let lastError: Error | null = null;

  for (const params of variants) {
    try {
      const rows = await fetchRewardooPaymentsOnce(apiToken, params);
      for (const row of rows) {
        merged.set(dedupeKey(row), row);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  for (const op of ['payment', 'payment_summary', 'withdraw'] as const) {
    try {
      const parsed = await postRewardooApi('commission', op, {
        token: apiToken.trim(),
        request_begin: rangeBegin,
        request_end: rangeEnd,
      });
      if (parsed.code !== 0) continue;
      for (const row of coerceRewardooPaymentRows(parsed.rows)) {
        merged.set(dedupeKey(row), row);
      }
    } catch {
      /* 部分站点无此 op */
    }
  }

  if (merged.size === 0 && lastError) {
    throw lastError;
  }

  return [...merged.values()];
}

/**
 * 将打款记录汇总为结算报表上下半月应收/实收（USD）
 *
 * - 在途（processing / pending / Payment in Progress）→ 应收，按 Request Date
 * - withdrawn / paid → 实收，按 Paid Date
 */
export function aggregateRewardooPaymentsForSettlement(
  rows: RewardooPaymentRow[],
  month: string,
): RewardooPaymentHalfTotals {
  const out: RewardooPaymentHalfTotals = {
    receivableH1: 0,
    receivableH2: 0,
    actualH1: 0,
    actualH2: 0,
  };

  for (const row of rows) {
    const status = String(row.status ?? '').trim().toLowerCase();
    if (status === 'rejected') continue;

    const amount =
      parseMoney(row.commission) || parseMoney(row.withdrawal_amount) || parseMoney(row.amount);
    if (amount <= 0) continue;

    if (isRewardooReceivableStatus(status)) {
      let dateStr = parseRewardooRequestDate(row);
      if (!dateStr) {
        dateStr = parseYmdFlexible(row.update_time);
      }
      if (!dateStr || !dateStr.startsWith(`${month}-`)) continue;
      const day = Number(dateStr.slice(8, 10));
      if (day <= 15) out.receivableH1 += amount;
      else out.receivableH2 += amount;
      continue;
    }

    if (isRewardooActualStatus(status)) {
      const dateStr = parseRewardooPaidDate(row);
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
