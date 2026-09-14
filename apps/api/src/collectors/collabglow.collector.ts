import { PlatformStatusMapping } from '@prisma/client';

import {
  fetchNetworkV3Orders,
  normalizeNetworkV3Orders,
  NetworkV3Order,
  NetworkV3TransactionTotals,
  summarizeNetworkV3TransactionApi,
} from './transaction-v3-network.collector';
import { NormalizedOrder } from './types';

const CG_TRANSACTION_V3_API = 'https://api.collabglow.com/api/transaction_v3';
const CG_SOURCE = 'collabglow';

export type CgOrder = NetworkV3Order;
export type CgTransactionTotals = NetworkV3TransactionTotals;

/**
 * CollabGlow 订单采集（Transaction API V3）
 */
export async function fetchCollabGlowOrders(
  apiToken: string,
  startDate: string,
  endDate: string,
): Promise<CgOrder[]> {
  return fetchNetworkV3Orders(CG_TRANSACTION_V3_API, CG_SOURCE, apiToken, startDate, endDate);
}

/**
 * CollabGlow 订单归一化
 */
export function normalizeCollabGlowOrders(
  orders: CgOrder[],
  mappings: PlatformStatusMapping[],
): NormalizedOrder[] {
  return normalizeNetworkV3Orders(orders, mappings);
}

/**
 * CollabGlow Transaction V3 汇总统计
 */
export function summarizeCgTransactionApi(orders: CgOrder[]): CgTransactionTotals {
  return summarizeNetworkV3TransactionApi(orders);
}
