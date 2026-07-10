import axios from 'axios';

import { PlatformStatusMapping } from '@prisma/client';

import {
  addToCommissionBreakdown,
  attachCommissionBreakdownToPayload,
  emptyCommissionBreakdown,
  mergeMixedOrderStatus,
} from '../common/commission-breakdown-collector.util';
import { CommissionBreakdown } from '../common/order-commission-buckets.util';
import { parseAffiliateOrderDateUtc8 } from '../common/affiliate-order-date.util';

import { NormalizedOrder } from './types';

import { normalizeStatus } from './status-normalizer';

const PM_API = 'https://api.partnermatic.com/api/transaction';

const PM_MAX_DAYS_PER_REQUEST = 62;

const PM_REQUEST_INTERVAL_MS = 1500;

interface PmItem {
  status?: string;
  sale_amount?: number | string;
  sale_comm?: number | string;
}

interface PmOrder {
  oid?: string;
  order_id?: string;
  mid?: string;
  brand_id?: string;
  merchant_name?: string;
  mcid?: string;
  order_time?: string | number;
  status?: string;
  sale_amount?: number | string;
  sale_comm?: number | string;
  items?: PmItem[];
}

type PmMergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/** PM Transaction API 汇总（与 scripts/pm-compare.ts 一致） */
export interface PmTransactionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 将日期区间按 PartnerMatic API 上限（62 天）切分
 */
export function buildPmDateChunks(
  startDate: string,
  endDate: string,
  maxDays = PM_MAX_DAYS_PER_REQUEST,
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
 * PartnerMatic 订单采集
 */
export async function fetchPartnerMaticOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<PmOrder[]> {
  const perPage = 2000;
  const all: PmOrder[] = [];
  const chunks = buildPmDateChunks(startDate, endDate);

  for (const chunk of chunks) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 500) {
      const response = await axios.post(
        PM_API,
        {
          source: 'partnermatic',
          token: apiToken,
          dataScope: 'user',
          beginDate: chunk.begin,
          endDate: chunk.end,
          curPage: page,
          perPage,
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
      );

      if (response.data?.code === '1002') {
        await sleep(2000);
        continue;
      }

      if (response.data?.code !== '0' || !response.data?.data?.list) {
        throw new Error(response.data?.message ?? 'PartnerMatic API 错误');
      }

      const list: PmOrder[] = response.data.data.list;
      const total = response.data.data.total ?? list.length;
      totalPages = Math.ceil(total / perPage) || 1;
      all.push(...list);

      page += 1;
      if (page <= totalPages) await sleep(PM_REQUEST_INTERVAL_MS);
    }
  }

  return all;
}

/**
 * 按 oid 合并多商品行，并按子行 status 拆分失效/待确认/已确认佣金
 */
export function normalizePartnerMaticOrders(
  orders: PmOrder[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const orderMap = new Map<string, PmMergeEntry>();

  for (const order of orders) {
    const orderId = String(order.oid ?? order.order_id ?? '').trim();
    if (!orderId) continue;

    const merchantId = order.mid ?? order.brand_id ?? null;
    const merchantName = order.merchant_name ?? null;
    const mcid = order.mcid ?? null;
    const orderDate = parseAffiliateOrderDateUtc8(order.order_time);
    const items = order.items?.length ? order.items : [order as unknown as PmItem];

    for (const item of items) {
      const orderAmount = parseFloat(String(item.sale_amount ?? 0)) || 0;
      const commission = parseFloat(String(item.sale_comm ?? 0)) || 0;
      const { rawStatus, normalizedStatus } = normalizeStatus(item.status ?? order.status, mappings);

      const existing = orderMap.get(orderId);
      if (existing) {
        existing.orderAmount += orderAmount;
        existing.commission += commission;
        existing.rawPayload = order;
        addToCommissionBreakdown(existing.breakdown, normalizedStatus, commission);
        mergeMixedOrderStatus(existing, { normalizedStatus, rawStatus });
      } else {
        const breakdown = emptyCommissionBreakdown();
        addToCommissionBreakdown(breakdown, normalizedStatus, commission);
        orderMap.set(orderId, {
          externalOrderId: orderId,
          merchantId: merchantId ? String(merchantId) : null,
          merchantName,
          merchantSlug: mcid ? String(mcid) : null,
          productId: null,
          orderAmount,
          commission,
          currency: 'USD',
          rawStatus,
          normalizedStatus,
          orderDate,
          rawPayload: order,
          breakdown,
        });
      }
    }
  }

  return [...orderMap.values()].map((entry) => {
    const { breakdown, rawPayload, ...orderRow } = entry;
    return {
      ...orderRow,
      rawPayload: attachCommissionBreakdownToPayload(rawPayload, breakdown),
    };
  });
}

/**
 * 统计 API 原始行数与合并后订单数、佣金（用于采集结果提示）
 */
export function summarizePmTransactionApi(orders: PmOrder[]): PmTransactionTotals {
  const normalized = normalizePartnerMaticOrders(orders, []);
  const orderComm = normalized.reduce((s, o) => s + o.commission, 0);
  return {
    apiListRows: orders.length,
    orderCount: normalized.length,
    totalCommission: Math.round(orderComm * 100) / 100,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
