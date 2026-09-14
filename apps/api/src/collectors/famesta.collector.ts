import { PlatformStatusMapping } from '@prisma/client';

import {
  fetchNetworkV3Orders,
  normalizeNetworkV3Orders,
  NetworkV3Order,
  NetworkV3TransactionTotals,
  summarizeNetworkV3TransactionApi,
} from './transaction-v3-network.collector';
import { NormalizedOrder } from './types';

const FS_TRANSACTION_V3_API = 'https://api.famesta.com/api/transaction_v3';
const FS_SOURCE = 'famesta';

export type FsOrder = NetworkV3Order;
export type FsTransactionTotals = NetworkV3TransactionTotals;

/**
 * Famesta 订单采集（Transaction API V3）
 */
export async function fetchFamestaOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<FsOrder[]> {
  return fetchNetworkV3Orders(FS_TRANSACTION_V3_API, FS_SOURCE, apiToken, startDate, endDate);
}

/**
 * Famesta 订单归一化
 */
export function normalizeFamestaOrders(
  orders: FsOrder[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  return normalizeNetworkV3Orders(orders, mappings);
}

/**
 * Famesta Transaction V3 汇总统计
 */
export function summarizeFsTransactionApi(orders: FsOrder[]): FsTransactionTotals {
  return summarizeNetworkV3TransactionApi(orders);
}
