import axios from 'axios';

import { NormalizedOrder } from './types';

import { normalizeStatus } from './status-normalizer';

import { parseAffiliateOrderDateUtc8 } from '../common/affiliate-order-date.util';

import { NormalizedStatus, PlatformStatusMapping } from '@prisma/client';



const PM_API = 'https://api.partnermatic.com/api/transaction';



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

  items?: PmItem[];

}



/** PM Transaction API 汇总（与 scripts/pm-compare.ts 一致） */

export interface PmTransactionTotals {

  apiListRows: number;

  orderCount: number;

  totalCommission: number;

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

  let page = 1;

  let totalPages = 1;



  while (page <= totalPages && page <= 500) {

    const response = await axios.post(

      PM_API,

      {

        source: 'partnermatic',

        token: apiToken,

        dataScope: 'user',

        beginDate: startDate,

        endDate: endDate,

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

    if (page <= totalPages) await sleep(1500);

  }



  return all;

}



/**

 * 按订单号 oid 合并多商品行（佣金累加），与 PM transaction / transaction_v3 的 total 口径一致

 */

export function normalizePartnerMaticOrders(

  orders: PmOrder[],

  mappings: PlatformStatusMapping[],

): NormalizedOrder[] {

  const orderMap = new Map<string, NormalizedOrder>();



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

      const { rawStatus, normalizedStatus } = normalizeStatus(item.status, mappings);



      const existing = orderMap.get(orderId);

      if (existing) {

        existing.orderAmount += orderAmount;

        existing.commission += commission;

        existing.rawPayload = { order, items: items.length };

        if (normalizedStatus === NormalizedStatus.rejected) {

          existing.normalizedStatus = NormalizedStatus.rejected;

          existing.rawStatus = rawStatus;

        } else if (

          existing.normalizedStatus !== NormalizedStatus.rejected &&

          normalizedStatus === NormalizedStatus.approved

        ) {

          existing.normalizedStatus = NormalizedStatus.approved;

          existing.rawStatus = rawStatus;

        }

      } else {

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

          rawPayload: { order, items: items.length },

        });

      }

    }

  }



  return Array.from(orderMap.values());

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


