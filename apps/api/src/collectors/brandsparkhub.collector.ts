import { PlatformStatusMapping } from '@prisma/client';

import {
  fetchNetworkV3Orders,
  normalizeNetworkV3Orders,
  NetworkV3Order,
  NetworkV3TransactionTotals,
  summarizeNetworkV3TransactionApi,
} from './transaction-v3-network.collector';
import { NormalizedOrder } from './types';

const BSH_TRANSACTION_V3_API = 'https://api.brandsparkhub.com/api/transaction_v3';
const BSH_SOURCE = 'brandsparkhub';

export type BshOrder = NetworkV3Order;
export type BshTransactionTotals = NetworkV3TransactionTotals;

/**
 * Brandsparkhub 订单采集（Transaction API V3）
 */
export async function fetchBrandsparkhubOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<BshOrder[]> {
  return fetchNetworkV3Orders(BSH_TRANSACTION_V3_API, BSH_SOURCE, apiToken, startDate, endDate);
}

/**
 * Brandsparkhub 订单归一化
 */
export function normalizeBrandsparkhubOrders(
  orders: BshOrder[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  return normalizeNetworkV3Orders(orders, mappings);
}

/**
 * Brandsparkhub Transaction V3 汇总统计
 */
export function summarizeBshTransactionApi(orders: BshOrder[]): BshTransactionTotals {
  return summarizeNetworkV3TransactionApi(orders);
}
