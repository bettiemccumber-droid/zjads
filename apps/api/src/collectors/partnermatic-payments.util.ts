import type { NetworkV2PaymentHalfTotals } from './network-v2-payment-details.util';
import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  fetchNetworkV2PaymentSummaryForRange,
  type NetworkV2PaymentSummaryRow,
} from './network-v2-payment-summary.util';

export type PartnermaticPaymentSummaryRow = NetworkV2PaymentSummaryRow;
export type PartnermaticPaymentHalfTotals = NetworkV2PaymentHalfTotals;

const PM_SUMMARY_CONFIG = {
  summaryUrl: 'https://api.partnermatic.com/api/payment_summary',
  source: 'partnermatic',
  networkLabel: 'Partnermatic',
};

/**
 * 拉取 Partnermatic Payment Summary
 * @see https://app.partnermatic.com/tools/apis/payment_summary_api/5
 */
export async function fetchPartnermaticPaymentSummary(
  token: string,
  rangeBegin: string,
  rangeEnd: string,
): Promise<PartnermaticPaymentSummaryRow[]> {
  return fetchNetworkV2PaymentSummaryForRange(PM_SUMMARY_CONFIG, token, rangeBegin, rangeEnd);
}

export const aggregatePartnermaticPaymentSummaryForSettlement =
  aggregateNetworkV2PaymentSummaryForSettlement;
