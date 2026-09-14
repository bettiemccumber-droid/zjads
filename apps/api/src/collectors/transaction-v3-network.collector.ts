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

const V3_REQUEST_INTERVAL_MS = 1500;

interface NetworkV3Item {
  skuid?: string;
  status?: string;
  sale_amount?: number | string;
  sale_comm?: number | string;
  prod_id?: string;
}

export interface NetworkV3Order {
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
  items?: NetworkV3Item[];
}

type NetworkV3MergeEntry = NormalizedOrder & { breakdown: CommissionBreakdown };

/** Transaction V3 汇总 */
export interface NetworkV3TransactionTotals {
  apiListRows: number;
  orderCount: number;
  totalCommission: number;
}

/**
 * 解析商家 ID：优先 mid，为 0 时 fallback mcid
 */
export function resolveNetworkV3MerchantId(order: NetworkV3Order): string | null {
  const mid = order.mid;
  if (mid != null && String(mid).trim() !== '' && Number(mid) !== 0) {
    return String(mid);
  }
  const mcid = order.mcid?.trim();
  return mcid || null;
}

/**
 * 拉取 PM 系 Transaction API V3 订单（CollabGlow / Famesta 等）
 */
export async function fetchNetworkV3Orders(
  apiUrl: string,
  source: string,
  apiToken: string,
  startDate: string,
  endDate: string,
  dataScope: 'channel' | 'user' = 'user',
): Promise<NetworkV3Order[]> {
  const perPage = 2000;
  const all: NetworkV3Order[] = [];
  const chunks = buildPmDateChunks(startDate, endDate);

  for (const chunk of chunks) {
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages && page <= 500) {
      const response = await axios.post(
        apiUrl,
        {
          source,
          token: apiToken,
          dataScope,
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
        await sleep(V3_REQUEST_INTERVAL_MS + 500);
        continue;
      }

      if (response.data?.code !== '0' || !response.data?.data?.list) {
        throw new Error(response.data?.message ?? `${source} Transaction V3 错误`);
      }

      const list: NetworkV3Order[] = response.data.data.list;
      const total = response.data.data.total ?? list.length;
      totalPages = (response.data.data.totalPage ?? Math.ceil(total / perPage)) || 1;
      all.push(...list);

      page += 1;
      if (page <= totalPages) await sleep(V3_REQUEST_INTERVAL_MS);
    }
  }

  return all;
}

/**
 * 按 oid 合并多商品行
 */
export function normalizeNetworkV3Orders(
  orders: NetworkV3Order[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  const orderMap = new Map<string, NetworkV3MergeEntry>();

  for (const order of orders) {
    const orderId = String(order.oid ?? order.order_id ?? '').trim();
    if (!orderId) continue;

    const merchantId = resolveNetworkV3MerchantId(order);
    const merchantName = order.merchant_name ?? null;
    const mcid = order.mcid ?? null;
    const orderDate = parseAffiliateOrderDateUtc8(order.order_time ?? order.ori_order_time);
    const items = order.items?.length ? order.items : [order as unknown as NetworkV3Item];

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
export function summarizeNetworkV3TransactionApi(orders: NetworkV3Order[]): NetworkV3TransactionTotals {
  const normalized = normalizeNetworkV3Orders(orders, []);
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
