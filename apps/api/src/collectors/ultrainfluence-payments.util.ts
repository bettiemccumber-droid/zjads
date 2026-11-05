import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  fetchNetworkV2PaymentSummaryForRange,
} from './network-v2-payment-summary.util';

const UI_SUMMARY_CONFIG = {
  summaryUrl: 'https://api.ultrainfluence.com/api/payment_summary',
  source: 'ultrainfluence',
  networkLabel: 'UltraInfluence',
};

export const fetchUltrainfluencePaymentSummary = (
  token: string,
  rangeBegin: string,
  rangeEnd: string,
) => fetchNetworkV2PaymentSummaryForRange(UI_SUMMARY_CONFIG, token, rangeBegin, rangeEnd);

export const aggregateUltrainfluencePaymentSummaryForSettlement =
  aggregateNetworkV2PaymentSummaryForSettlement;
