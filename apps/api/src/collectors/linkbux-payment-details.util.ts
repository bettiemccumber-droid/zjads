import axios from 'axios';
import { LB_API } from './linkbux-api.util';

/** LinkBux Payment Details API 单行（mod=settlement&op=merchant_commission） */
export interface LinkbuxMerchantCommissionRow {
  mid?: string | number;
  mcid?: string;
  merchant_name?: string;
  offer_type?: string;
  sale_comm?: string | number;
  settlement_date?: string;
  note?: string;
  settlement_id?: string;
  settlement_uuid?: string;
  payment_id?: string | number | null;
  paid_date?: string | null;
  settlement_type?: string;
}

export interface LinkbuxPaymentHalfTotals {
  receivableH1: number;
  receivableH2: number;
  actualH1: number;
  actualH2: number;
}

const MIN_REQUEST_INTERVAL_MS = 2500;
let lastRequestAt = 0;

async function throttleLbRequest() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt = Date.now();
}

function parseLbSettlementList(body: unknown): LinkbuxMerchantCommissionRow[] {
  const root = body as Record<string, unknown>;
  const status = root.status as { code?: number | string; msg?: string } | undefined;
  const code = status?.code ?? root.code;
  if (code !== 0 && code !== '0' && code !== 200 && code !== '200') {
    const msg = String(status?.msg ?? root.msg ?? 'LinkBux API 错误');
    throw new Error(`${msg} (code=${String(code)})`);
  }
  if (Array.isArray(root.data)) {
    return root.data as LinkbuxMerchantCommissionRow[];
  }
  const payload = root.payload ?? root.payliad;
  if (Array.isArray(payload)) {
    return payload as LinkbuxMerchantCommissionRow[];
  }
  return [];
}

function parseMoney(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseYmd(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function isPaid(row: LinkbuxMerchantCommissionRow): boolean {
  const paid = parseYmd(row.paid_date);
  if (paid) return true;
  const pid = row.payment_id;
  if (pid == null || pid === '' || pid === '0') return false;
  return true;
}

/**
 * 拉取 LinkBux 商家结算明细（validation 区间 begin_date ~ end_date，跨度 ≤62 天）
 * @see https://www.linkbux.com/publisher/tools/api/payment_details_api/
 */
export async function fetchLinkbuxMerchantCommissions(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<LinkbuxMerchantCommissionRow[]> {
  await throttleLbRequest();
  const { data } = await axios.get(LB_API, {
    params: {
      mod: 'settlement',
      op: 'merchant_commission',
      token: token.trim(),
      begin_date: beginDate,
      end_date: endDate,
      type: 'json',
    },
    timeout: 120000,
    validateStatus: () => true,
  });
  return parseLbSettlementList(data);
}

/**
 * 汇总为结算报表上下半月应收/实收（USD）
 *
 * - 未打款（paid_date 为空）→ 应收，按 settlement_date 落月/半月
 * - 已打款且 paid_date 在结算月内 → 实收，按 paid_date 落半月
 */
export function aggregateLinkbuxCommissionsForSettlement(
  rows: LinkbuxMerchantCommissionRow[],
  month: string,
): LinkbuxPaymentHalfTotals {
  const out: LinkbuxPaymentHalfTotals = {
    receivableH1: 0,
    receivableH2: 0,
    actualH1: 0,
    actualH2: 0,
  };

  for (const row of rows) {
    const comm = parseMoney(row.sale_comm);
    if (comm <= 0) continue;

    if (isPaid(row)) {
      const paid = parseYmd(row.paid_date);
      if (!paid || !paid.startsWith(`${month}-`)) continue;
      const day = Number(paid.slice(8, 10));
      if (day <= 15) out.actualH1 += comm;
      else out.actualH2 += comm;
      continue;
    }

    const settled = parseYmd(row.settlement_date);
    if (!settled || !settled.startsWith(`${month}-`)) continue;
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
