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

/** 解析金额（API 可能带千分位逗号） */
function parseMoney(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 解析日期（文档 YYYY-MM-DD；后台表格常见 MM-DD-YYYY）
 */
function parseYmd(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

/** 仅 paid_date 表示已实收；有 payment_id 但无 paid_date 为在途提现（Pending） */
function isPaid(row: LinkbuxMerchantCommissionRow): boolean {
  const paid = parseYmd(row.paid_date);
  return paid != null && paid !== '0000-00-00';
}

function hasPendingPaymentId(row: LinkbuxMerchantCommissionRow): boolean {
  const id = row.payment_id;
  if (id == null || id === '') return false;
  return String(id).trim() !== '' && String(id) !== '0';
}

/**
 * validation 查询 begin_date：在结算月之前扩展窗口（API 单次跨度 ≤62 天），便于 Pending 批次含历史 settlement 行
 */
export function linkbuxValidationBeginDate(monthEndDate: string): string {
  const end = new Date(`${monthEndDate}T12:00:00Z`);
  const begin = new Date(end);
  begin.setUTCDate(begin.getUTCDate() - 61);
  const ymd = begin.toISOString().slice(0, 10);
  return ymd < '2023-01-01' ? '2023-01-01' : ymd;
}

/**
 * 合并 validation / paid_date 两次拉取，按 settlement_uuid 去重
 */
export function dedupeLinkbuxMerchantCommissionRows(
  rows: LinkbuxMerchantCommissionRow[],
): LinkbuxMerchantCommissionRow[] {
  const seen = new Set<string>();
  const out: LinkbuxMerchantCommissionRow[] = [];
  for (const row of rows) {
    const key = String(
      row.settlement_uuid ??
        row.settlement_id ??
        `${row.mid ?? ''}|${row.mcid ?? ''}|${row.settlement_date ?? ''}|${row.sale_comm ?? ''}|${row.paid_date ?? ''}`,
    );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function bucketHalfMonth(month: string, ymd: string): 'h1' | 'h2' {
  const day = Number(ymd.slice(8, 10));
  return day <= 15 ? 'h1' : 'h2';
}

/**
 * 应收落半月：settlement_date 在结算月内按日；在途 payment_id 且 settlement 不在月内时归入上半月（对齐后台 Pending 提现月）
 */
function bucketLinkbuxReceivableHalf(
  month: string,
  settlementYmd: string | null,
  pendingPayment: boolean,
): 'h1' | 'h2' | null {
  if (settlementYmd?.startsWith(`${month}-`)) {
    return bucketHalfMonth(month, settlementYmd);
  }
  if (pendingPayment) return 'h1';
  return null;
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
 * Payment Details API：按 paid_date 区间拉已付明细。
 * LinkBux 实测：仅 paid_date_begin/end 会 1003，须同时带 begin_date/end_date（validation 区间）。
 */
export async function fetchLinkbuxMerchantCommissionsByPaidDate(
  token: string,
  validationBegin: string,
  validationEnd: string,
  paidDateBegin: string,
  paidDateEnd: string,
): Promise<LinkbuxMerchantCommissionRow[]> {
  await throttleLbRequest();
  const { data } = await axios.get(LB_API, {
    params: {
      mod: 'settlement',
      op: 'merchant_commission',
      token: token.trim(),
      begin_date: validationBegin,
      end_date: validationEnd,
      paid_date_begin: paidDateBegin,
      paid_date_end: paidDateEnd,
      type: 'json',
    },
    timeout: 120000,
    validateStatus: () => true,
  });
  return parseLbSettlementList(data);
}

/**
 * 仅汇总实收（paid_date 落在结算月）
 */
export function aggregateLinkbuxActualCommissionsForSettlement(
  rows: LinkbuxMerchantCommissionRow[],
  month: string,
): Pick<LinkbuxPaymentHalfTotals, 'actualH1' | 'actualH2'> {
  const out = { actualH1: 0, actualH2: 0 };
  for (const row of rows) {
    const comm = parseMoney(row.sale_comm);
    if (comm <= 0 || !isPaid(row)) continue;
    const paid = parseYmd(row.paid_date);
    if (!paid || !paid.startsWith(`${month}-`)) continue;
    const day = Number(paid.slice(8, 10));
    if (day <= 15) out.actualH1 += comm;
    else out.actualH2 += comm;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  out.actualH1 = round(out.actualH1);
  out.actualH2 = round(out.actualH2);
  return out;
}

/**
 * 仅汇总应收（官方：paid_date 为空 = 尚未付给你；按 validation 字段 settlement_date 落月）
 * @see https://www.linkbux.com/publisher/tools/api/payment_details_api/
 */
export function aggregateLinkbuxReceivableCommissionsForSettlement(
  rows: LinkbuxMerchantCommissionRow[],
  month: string,
): Pick<LinkbuxPaymentHalfTotals, 'receivableH1' | 'receivableH2'> {
  const out = { receivableH1: 0, receivableH2: 0 };
  for (const row of rows) {
    const comm = parseMoney(row.sale_comm);
    if (comm <= 0 || isPaid(row)) continue;
    const settled = parseYmd(row.settlement_date);
    const half = bucketLinkbuxReceivableHalf(month, settled, hasPendingPaymentId(row));
    if (!half) continue;
    if (half === 'h1') out.receivableH1 += comm;
    else out.receivableH2 += comm;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  out.receivableH1 = round(out.receivableH1);
  out.receivableH2 = round(out.receivableH2);
  return out;
}

/**
 * 汇总为结算报表上下半月应收/实收（USD）
 *
 * - 未打款（无 paid_date）→ 应收，按 settlement_date 落月/半月
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
    const half = bucketLinkbuxReceivableHalf(
      month,
      settled,
      hasPendingPaymentId(row),
    );
    if (!half) continue;
    if (half === 'h1') out.receivableH1 += comm;
    else out.receivableH2 += comm;
  }

  const round = (n: number) => Math.round(n * 100) / 100;
  out.receivableH1 = round(out.receivableH1);
  out.receivableH2 = round(out.receivableH2);
  out.actualH1 = round(out.actualH1);
  out.actualH2 = round(out.actualH2);
  return out;
}
