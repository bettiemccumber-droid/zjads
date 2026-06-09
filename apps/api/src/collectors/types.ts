import { NormalizedStatus } from '@prisma/client';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface NormalizedOrder {
  externalOrderId: string;
  merchantId: string | null;
  merchantName: string | null;
  merchantSlug: string | null;
  productId: string | null;
  orderAmount: number;
  commission: number;
  currency: string;
  rawStatus: string;
  normalizedStatus: NormalizedStatus;
  orderDate: Date;
  rawPayload: unknown;
}

export interface CollectResult {
  fetched: number;
  inserted: number;
  updated: number;
}
