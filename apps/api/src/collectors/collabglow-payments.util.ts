import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  fetchNetworkV2PaymentSummaryForRange,
} from './network-v2-payment-summary.util';

const CG_SUMMARY_CONFIG = {
  summaryUrl: 'https://api.collabglow.com/api/payment_summary',
  source: 'collabglow',
  networkLabel: 'CollabGlow',
};

export const fetchCollabglowPaymentSummary = (
  token: string,
  rangeBegin: string,
  rangeEnd: string,
) => fetchNetworkV2PaymentSummaryForRange(CG_SUMMARY_CONFIG, token, rangeBegin, rangeEnd);

export const aggregateCollabglowPaymentSummaryForSettlement =
  aggregateNetworkV2PaymentSummaryForSettlement;
