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

import { buildPmDateChunks } from './partnermatic.collector';
import { NormalizedOrder } from './types';

import { normalizeStatus } from './status-normalizer';

const UI_API = 'https://api.ultrainfluence.com/api/transaction_v3';

const UI_REQUEST_INTERVAL_MS = 1500;

interface UiItem {
  ultrainfluence_id?: string;
  skuid?: string;
  status?: string;
  sale_amount?: number | string;
  sale_comm?: number | string;
  prod_id?: string;
}

interface UiOrder {
  oid?: string;
  order_id?: string;
  mid?: number | string;
  merchant_name?: string | null;
  mcid?: string;
  order_time?: string | number;
  ori_order_time?: number;
  status?: string;
  sale_amount?: number | string;
  sale_comm?: number | string;
  items?: UiItem[];
}

type UiMergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/** UI Transaction V3 汇总 */
export interface UiTransactionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 解析 UI 商家 ID：优先 mid，为 0 时 fallback mcid
 */
export function resolveUiMerchantId(order: UiOrder): string | null {
  const mid = order.mid;
  if (mid != null && String(mid).trim() !== '' && Number(mid) !== 0) {
    return String(mid);
  }
  const mcid = order.mcid?.trim();
  return mcid || null;
}

/**
 * UltraInfluence 订单采集（Transaction API V3）
 */
export async function fetchUltraInfluenceOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<UiOrder[]> {
  const perPage = 2000;
  const all: UiOrder[] = [];
  const chunks = buildPmDateChunks(startDate, endDate);

  for (const chunk of chunks) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 500) {
      const response = await axios.post(
        UI_API,
        {
          source: 'ultrainfluence',
          token: apiToken,
          dataScope: 'user',
          beginDate: chunk.begin,
          endDate: chunk.end,
          updateBeginDate: '',
          updateEndDate: '',
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
        throw new Error(response.data?.message ?? 'UltraInfluence Transaction V3 错误');
      }

      const list: UiOrder[] = response.data.data.list;
      const total = response.data.data.total ?? list.length;
      totalPages =
        (response.data.data.totalPage ??
          Math.ceil(total / perPage)) || 1;
      all.push(...list);

      page += 1;
      if (page <= totalPages) await sleep(UI_REQUEST_INTERVAL_MS);
    }
  }

  return all;
}

/**
 * 按 oid 合并多商品行（与 PM / UI Performance All Tab 订单数一致）
 */
export function normalizeUltraInfluenceOrders(
  orders: UiOrder[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const orderMap = new Map<string, UiMergeEntry>();

  for (const order of orders) {
    const orderId = String(order.oid ?? order.order_id ?? '').trim();
    if (!orderId) continue;

    const merchantId = resolveUiMerchantId(order);
    const merchantName = order.merchant_name ?? null;
    const mcid = order.mcid ?? null;
    const orderDate = parseAffiliateOrderDateUtc8(order.order_time ?? order.ori_order_time);
    const items = order.items?.length ? order.items : [order as unknown as UiItem];

    for (const item of items) {
      const orderAmount = parseFloat(String(item.sale_amount ?? 0)) || 0;
      const commission = parseFloat(String(item.sale_comm ?? 0)) || 0;
      const { rawStatus, normalizedStatus } = normalizeStatus(item.status ?? order.status, mappings);
      const productId = item.prod_id ? String(item.prod_id) : null;

      const existing = orderMap.get(orderId);
      if (existing) {
        existing.orderAmount += orderAmount;
        existing.commission += commission;
        existing.rawPayload = order;
        if (productId && !existing.productId) existing.productId = productId;
        addToCommissionBreakdown(existing.breakdown, normalizedStatus, commission);
        mergeMixedOrderStatus(existing, { normalizedStatus, rawStatus });
      } else {
        const breakdown = emptyCommissionBreakdown();
        addToCommissionBreakdown(breakdown, normalizedStatus, commission);
        orderMap.set(orderId, {
          externalOrderId: orderId,
          merchantId,
          merchantName,
          merchantSlug: mcid ? String(mcid) : null,
          productId,
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
 * 统计 API 原始行数与合并后订单数、佣金
 */
export function summarizeUiTransactionApi(orders: UiOrder[]): UiTransactionTotals {
  const normalized = normalizeUltraInfluenceOrders(orders, []);
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
