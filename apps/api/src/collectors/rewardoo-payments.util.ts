import { postRewardooApi } from './rewardoo-api.util';

/** Rewardoo Payments API 单行（mod=commission&op=payments） */
export interface RewardooPaymentRow {
  withdrawal_id?: string | number;
  withdrawal_time?: string;
  withdrawal_amount?: string | number;
  commission?: string | number;
  advertising_fee?: string | number;
  other_revenue?: string | number;
  status?: string;
  account_balance?: string | number;
  update_time?: string;
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
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 解析打款时间（优先 withdrawal_time，其次 update_time）
 */
export function parseRewardooPaymentDate(row: RewardooPaymentRow): string | null {
  const raw = (row.withdrawal_time || row.update_time || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * 拉取 Rewardoo 打款记录（payment_begin/end 为平台付款日期区间）
 */
export async function fetchRewardooPayments(
  apiToken: string,
  paymentBegin: string,
  paymentEnd: string,
): Promise<RewardooPaymentRow[]> {
  const parsed = await postRewardooApi('commission', 'payments', {
    token: apiToken.trim(),
    payment_begin: paymentBegin,
    payment_end: paymentEnd,
  });
  if (parsed.code !== 0) {
    throw new Error(parsed.message || `Rewardoo Payments API 错误 code=${parsed.code}`);
  }
  return parsed.rows as RewardooPaymentRow[];
}

/**
 * 将打款记录汇总为结算报表上下半月应收/实收（USD）
 *
 * - status=processing → 应收（在途）
 * - status=withdrawn → 实收（已打款）
 * - 金额优先用 commission，否则 withdrawal_amount
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
    const dateStr = parseRewardooPaymentDate(row);
    if (!dateStr || !dateStr.startsWith(`${month}-`)) continue;

    const status = String(row.status ?? '').trim().toLowerCase();
    if (status === 'rejected') continue;

    const amount = parseMoney(row.commission) || parseMoney(row.withdrawal_amount);
    if (amount <= 0) continue;

    const day = Number(dateStr.slice(8, 10));
    const isH1 = day <= 15;

    if (status === 'processing') {
      if (isH1) out.receivableH1 += amount;
      else out.receivableH2 += amount;
    } else if (status === 'withdrawn') {
      if (isH1) out.actualH1 += amount;
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
