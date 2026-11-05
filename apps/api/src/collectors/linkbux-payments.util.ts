import axios from 'axios';
import { LB_API, LB_API2 } from './linkbux-api.util';
import type { LinkbuxPaymentHalfTotals } from './linkbux-payment-details.util';

/** LinkBux 付款历史 / Payment Summary 单行（与后台 Payment ID 列表一致） */
export interface LinkbuxPaymentRow {
  payment_id?: string | number;
  amount?: string | number;
  payment_amount?: string | number;
  total?: string | number;
  status?: string;
  date?: string;
  request_date?: string;
  create_date?: string;
  paid_date?: string | null;
  payment_date?: string | null;
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

function parseMoney(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * 解析 LinkBux 界面日期（支持 YYYY-MM-DD 与 MM-DD-YYYY）
 */
export function parseLinkbuxPaymentDate(row: LinkbuxPaymentRow, preferPaid = false): string | null {
  const candidates = preferPaid
    ? [row.paid_date, row.payment_date, row.date, row.request_date, row.create_date]
    : [row.date, row.request_date, row.create_date, row.paid_date, row.payment_date];
  for (const raw of candidates) {
    const ymd = parseYmdFlexible(raw);
    if (ymd) return ymd;
  }
  return null;
}

function parseYmdFlexible(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[1]}-${m[2]}`;
  return null;
}

function lbResponseCode(body: unknown): number | string | undefined {
  const root = body as Record<string, unknown>;
  const statusRaw = root.status;
  if (typeof statusRaw === 'number' || typeof statusRaw === 'string') return statusRaw;
  const status = statusRaw as { code?: number | string; msg?: string } | undefined;
  const code = status?.code ?? root.code;
  if (typeof code === 'number' || typeof code === 'string') return code;
  return undefined;
}

function lbResponseMsg(body: unknown): string {
  const root = body as Record<string, unknown>;
  const statusRaw = root.status;
  if (statusRaw && typeof statusRaw === 'object') {
    return String((statusRaw as { msg?: string }).msg ?? '');
  }
  return String(root.msg ?? root.info ?? '');
}

/** 1003 缺参；api2 的 1001 missing auth_token 仅支持登录 Cookie，可跳过 */
function isLbSkippableProbeError(body: unknown): boolean {
  const code = lbResponseCode(body);
  const msg = lbResponseMsg(body).toLowerCase();
  if (code === 1003 || code === '1003') return true;
  if ((code === 1001 || code === '1001') && msg.includes('auth_token')) return true;
  return false;
}

function assertLbSuccess(body: unknown): void {
  const code = lbResponseCode(body);
  if (code !== 0 && code !== '0' && code !== 200 && code !== '200') {
    const root = body as Record<string, unknown>;
    const status = root.status as { msg?: string } | undefined;
    const msg = String(status?.msg ?? root.msg ?? 'LinkBux API 错误');
    throw new Error(`${msg} (code=${String(code)})`);
  }
}

function extractPaymentList(body: unknown): LinkbuxPaymentRow[] {
  const root = body as Record<string, unknown>;
  const rows: LinkbuxPaymentRow[] = [];

  const pushArr = (arr: unknown) => {
    if (Array.isArray(arr)) rows.push(...(arr as LinkbuxPaymentRow[]));
  };

  pushArr(root.data);
  pushArr(root.list);
  pushArr(root.payload);
  pushArr(root.payliad);

  const data = root.data as Record<string, unknown> | undefined;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of [
      'list',
      'payments',
      'payment_list',
      'payment_history',
      'history',
      'records',
    ] as const) {
      pushArr(data[key]);
    }
    const pip =
      parseMoney(data.payment_in_progress) ||
      parseMoney(data.paymentInProgress) ||
      parseMoney(data.payment_processing);
    if (pip > 0) {
      rows.push({
        status: 'Pending',
        amount: pip,
        date: String(
          data.last_update ?? data.last_updated ?? data.update_time ?? data.updated_at ?? '',
        ),
      });
    }
  }

  const result = root.result as Record<string, unknown> | undefined;
  if (result) {
    pushArr(result.list);
    pushArr(result.payments);
  }

  return rows;
}

function mergePaymentRows(
  merged: Map<string, LinkbuxPaymentRow>,
  list: LinkbuxPaymentRow[],
): void {
  for (const row of list) {
    const id =
      row.payment_id != null && String(row.payment_id).trim()
        ? String(row.payment_id)
        : `${parseLinkbuxPaymentDate(row, false) ?? ''}|${parseMoney(row.amount)}|${row.status ?? ''}`;
    merged.set(id, row);
  }
}

/**
 * 后台 Payment Summary 同源：api2.php mod=payment op=get_payment（优先于旧 api.php settlement）
 */
async function fetchLinkbuxPaymentsFromPublisherApi2(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<LinkbuxPaymentRow[]> {
  const bases = [LB_API2, LB_API];
  const paramSets: Record<string, string>[] = [
    {},
    { begin_date: beginDate, end_date: endDate },
    { request_begin: beginDate, request_end: endDate },
    { payment_begin: beginDate, payment_end: endDate },
  ];

  const merged = new Map<string, LinkbuxPaymentRow>();

  for (const base of bases) {
    for (const extra of paramSets) {
      await throttleLbRequest();
      try {
        const { data } = await axios.get(base, {
          params: {
            mod: 'payment',
            op: 'get_payment',
            token: token.trim(),
            type: 'json',
            ...extra,
          },
          timeout: 120000,
          validateStatus: () => true,
        });
        if (isLbSkippableProbeError(data)) continue;
        const code = lbResponseCode(data);
        if (code != null && code !== 0 && code !== '0' && code !== 200 && code !== '200') {
          continue;
        }
        const list = extractPaymentList(data);
        if (list.length) mergePaymentRows(merged, list);
      } catch {
        /* 尝试下一组参数 */
      }
    }
  }

  return [...merged.values()];
}

function isLinkbuxPendingStatus(status: string): boolean {
  const s = status.toLowerCase();
  return (
    s.includes('pending') ||
    s.includes('progress') ||
    s.includes('processing') ||
    s === 'unpaid'
  );
}

function isLinkbuxPaidStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'paid' || s === 'success' || s === 'successed' || s === 'completed';
}

/**
 * 拉取 LinkBux 付款历史（Payment Summary / Payment in Progress）
 * 依次尝试常见 settlement 子接口，直到返回列表。
 */
export async function fetchLinkbuxPayments(
  token: string,
  beginDate: string,
  endDate: string,
): Promise<LinkbuxPaymentRow[]> {
  const merged = new Map<string, LinkbuxPaymentRow>();
  let lastError: Error | null = null;

  /**
   * 媒体 Token 走 api.php（settlement / linkpayment）。
   * 后台 Network 的 api2.php?get_payment 需登录 Cookie auth_token，服务端无法用渠道 Token 复现。
   */
  const attempts: Array<{ mod: string; op: string; extra: Record<string, string> }> = [
    {
      mod: 'settlement',
      op: 'payments',
      extra: { begin_date: beginDate, end_date: endDate },
    },
    {
      mod: 'settlement',
      op: 'payments',
      extra: { request_begin: beginDate, request_end: endDate },
    },
    {
      mod: 'settlement',
      op: 'payment_history',
      extra: { begin_date: beginDate, end_date: endDate },
    },
    {
      mod: 'settlement',
      op: 'payments',
      extra: { payment_begin: beginDate, payment_end: endDate },
    },
    {
      mod: 'settlement',
      op: 'payment_history',
      extra: { request_begin: beginDate, request_end: endDate },
    },
    {
      mod: 'linkpayment',
      op: 'payment2',
      extra: { payment_begin: beginDate, payment_end: endDate },
    },
    {
      mod: 'linkpayment',
      op: 'payment',
      extra: { begin_date: beginDate, end_date: endDate },
    },
    {
      mod: 'linkpayment',
      op: 'payment2',
      extra: { begin_date: beginDate, end_date: endDate },
    },
  ];

  for (const attempt of attempts) {
    try {
      await throttleLbRequest();
      const { data } = await axios.get(LB_API, {
        params: {
          mod: attempt.mod,
          op: attempt.op,
          token: token.trim(),
          type: 'json',
          ...attempt.extra,
        },
        timeout: 120000,
        validateStatus: () => true,
      });
      if (isLbSkippableProbeError(data)) continue;
      assertLbSuccess(data);
      mergePaymentRows(merged, extractPaymentList(data));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (merged.size === 0) {
    try {
      mergePaymentRows(
        merged,
        await fetchLinkbuxPaymentsFromPublisherApi2(token, beginDate, endDate),
      );
    } catch (err) {
      if (!lastError) lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (merged.size === 0 && lastError) throw lastError;
  if (merged.size === 0) {
    throw new Error(
      'LinkBux 付款历史为空：请确认渠道 Token 有效（Tools API Token，非后台 JWT）。后台 get_payment 仅浏览器登录可用。',
    );
  }
  return [...merged.values()];
}

/**
 * 按付款历史汇总应收/实收（对齐后台 Payment Summary）
 *
 * - Pending / Payment in Progress → 应收（按列表 DATE / request_date）
 * - Paid → 实收（优先 paid_date，否则列表 DATE）
 */
export function aggregateLinkbuxPaymentsForSettlement(
  rows: LinkbuxPaymentRow[],
  month: string,
): LinkbuxPaymentHalfTotals {
  const out: LinkbuxPaymentHalfTotals = {
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

    if (isLinkbuxPendingStatus(status)) {
      const dateStr = parseLinkbuxPaymentDate(row, false);
      if (!dateStr || !dateStr.startsWith(`${month}-`)) continue;
      const day = Number(dateStr.slice(8, 10));
      if (day <= 15) out.receivableH1 += amount;
      else out.receivableH2 += amount;
      continue;
    }

    if (isLinkbuxPaidStatus(status)) {
      const dateStr = parseLinkbuxPaymentDate(row, true);
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
