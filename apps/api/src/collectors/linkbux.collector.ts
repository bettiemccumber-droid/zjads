import axios from 'axios';

import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';

import {
  addToCommissionBreakdown,
  attachCommissionBreakdownToPayload,
  emptyCommissionBreakdown,
  mergeMixedOrderStatus,
} from '../common/commission-breakdown-collector.util';
import { CommissionBreakdown } from '../common/order-commission-buckets.util';
import {
  isOrderDateInReportRange,
  parseAffiliateOrderDateUtc8,
} from '../common/affiliate-order-date.util';

import { normalizeStatus } from './status-normalizer';

import { NormalizedOrder } from './types';

const LB_API = 'https://www.linkbux.com/api.php';

const LB_MAX_DAYS_PER_REQUEST = 62;

const LB_PAGE_SIZE = 1000;

const LB_REQUEST_INTERVAL_MS = 2000;

/** LinkBux transaction_v2 单条商品/订单行 */
export interface LbTransactionRow {
  order_id?: string;
  linkbux_id?: string;
  mid?: string | number;
  merchant_name?: string;
  sale_amount?: string | number;
  sale_comm?: string | number;
  status?: string;
  order_time?: string | number;
  validation_date?: string;
}

export interface LbTransactionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

type LbMergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/**
 * 将日期区间按 LinkBux API 上限（62 天）切分
 */
export function buildLbDateChunks(
  startDate: string,
  endDate: string,
  maxDays = LB_MAX_DAYS_PER_REQUEST,
): { begin: string; end: string }[] {
  const slots: { begin: string; end: string }[] = [];
  let cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());

    slots.push({
      begin: cursor.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}

/**
 * 拉取 LinkBux 订单（transaction_v2，分页 + 62 天区间切分）
 */
export async function fetchLinkBuxOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
  onProgress?: (chunkIndex: number, totalChunks: number) => void | Promise<void>,
): Promise<LbTransactionRow[]> {
  const chunks = buildLbDateChunks(startDate, endDate);
  const all: LbTransactionRow[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const { begin, end } = chunks[i];
    await onProgress?.(i + 1, chunks.length);
    const rows = await fetchLbChunk(apiToken, begin, end);
    all.push(...rows);
    if (i < chunks.length - 1) await sleep(LB_REQUEST_INTERVAL_MS);
  }

  return all;
}

/**
 * 同一 order_id 合并多商品行，并按子行 status 拆分失效/待确认/已确认佣金
 */
export function normalizeLinkBuxOrders(
  rows: LbTransactionRow[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const map = new Map<string, LbMergeEntry>();

  for (const row of rows) {
    const externalOrderId = String(row.order_id ?? row.linkbux_id ?? '').trim();
    if (!externalOrderId) continue;

    const merchantId = row.mid != null ? String(row.mid) : null;
    const merchantName = row.merchant_name ?? null;
    const orderAmount = parseMoney(row.sale_amount);
    const commission = parseMoney(row.sale_comm);
    const rawStatusStr = normalizeLbRawStatus(row.status);
    const { rawStatus, normalizedStatus } = normalizeStatus(rawStatusStr, mappings);
    const orderDate = parseLbOrderDate(row);

    const existing = map.get(externalOrderId);
    if (existing) {
      existing.orderAmount += orderAmount;
      existing.commission += commission;
      existing.rawPayload = row;
      addToCommissionBreakdown(existing.breakdown, normalizedStatus, commission);
      mergeMixedOrderStatus(existing, { normalizedStatus, rawStatus });
    } else {
      const breakdown = emptyCommissionBreakdown();
      addToCommissionBreakdown(breakdown, normalizedStatus, commission);
      map.set(externalOrderId, {
        externalOrderId,
        merchantId,
        merchantName,
        merchantSlug: null,
        productId: null,
        orderAmount,
        commission,
        currency: 'USD',
        rawStatus,
        normalizedStatus,
        orderDate,
        rawPayload: row,
        breakdown,
      });
    }
  }

  return [...map.values()].map((entry) => {
    const { breakdown, rawPayload, ...order } = entry;
    return {
      ...order,
      rawPayload: attachCommissionBreakdownToPayload(rawPayload, breakdown),
    };
  });
}

/**
 * 按报表区间统计规范化订单（与商家汇总 orderDate 筛选一致）
 */
export function summarizeLbOrdersInRange(
  orders: NormalizedOrder[],
  startDate: string,
  endDate: string,
): Pick<LbTransactionTotals, 'orderCount' | 'totalCommission'> {
  const inRange = orders.filter((o) =>
    isOrderDateInReportRange(o.orderDate, startDate, endDate),
  );
  const totalCommission = inRange.reduce((s, o) => s + o.commission, 0);
  return {
    orderCount: inRange.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

export function summarizeLbTransactionApi(rows: LbTransactionRow[]): LbTransactionTotals {
  const normalized = normalizeLinkBuxOrders(rows, []);
  const totalCommission = normalized.reduce((s, o) => s + o.commission, 0);
  return {
    apiListRows: rows.length,
    orderCount: normalized.length,
    totalCommission: Math.round(totalCommission * 100) / 100,
  };
}

async function fetchLbChunk(
  apiToken: string,
  beginDate: string,
  endDate: string,
): Promise<LbTransactionRow[]> {
  const all: LbTransactionRow[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= 1000) {
    const params = new URLSearchParams({
      mod: 'medium',
      op: 'transaction_v2',
      token: apiToken,
      begin_date: beginDate,
      end_date: endDate,
      type: 'json',
      status: 'All',
      page: String(page),
      limit: String(LB_PAGE_SIZE),
    });

    const response = await axios.get(`${LB_API}?${params.toString()}`, {
      timeout: 120000,
    });

    const data = response.data as Record<string, unknown>;
    const errorCode =
      data.code ?? (data.status as { code?: number | string } | undefined)?.code;
    const errorMsg =
      (data.msg as string | undefined) ??
      (data.status as { msg?: string } | undefined)?.msg;

    if (
      errorCode === 1002 ||
      errorCode === '1002' ||
      (errorMsg && errorMsg.includes('频率'))
    ) {
      await sleep(2000);
      continue;
    }

    const isSuccess =
      data.code === 0 ||
      data.code === '0' ||
      (data.status as { code?: number | string } | undefined)?.code === 0 ||
      (data.status as { code?: number | string } | undefined)?.code === '0';

    if (!isSuccess || !data.data) {
      throw new Error(`LinkBux API 错误: ${errorMsg ?? '未知'} (code: ${String(errorCode)})`);
    }

    const payload = data.data as {
      list?: LbTransactionRow[];
      transactions?: LbTransactionRow[];
      total_page?: number;
    };
    const pageOrders = payload.list ?? payload.transactions ?? [];
    totalPages = payload.total_page ?? 1;
    all.push(...pageOrders);

    page += 1;
    if (page <= totalPages) await sleep(LB_REQUEST_INTERVAL_MS);
  }

  return all;
}

/** LB 原始状态 → 可读字符串（再交给 status-normalizer） */
function normalizeLbRawStatus(raw: string | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return 'Pending';
  if (s === 'Approved' || s.toUpperCase() === 'APPROVED') return 'Approved';
  if (s === 'Rejected' || s.toUpperCase() === 'REJECTED') return 'Rejected';
  if (s === 'Canceled' || s.toUpperCase() === 'CANCELED' || s.toUpperCase() === 'CANCELLED') {
    return 'Rejected';
  }
  return 'Pending';
}

function parseMoney(raw: string | number | undefined): number {
  const n = parseFloat(String(raw ?? 0));
  return Number.isFinite(n) ? n : 0;
}

function parseLbOrderDate(row: LbTransactionRow): Date {
  if (row.order_time != null && row.order_time !== '') {
    return parseAffiliateOrderDateUtc8(row.order_time);
  }

  if (row.validation_date && row.validation_date !== 'null') {
    return parseAffiliateOrderDateUtc8(row.validation_date);
  }

  return new Date();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
