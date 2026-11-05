import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  fetchNetworkV2PaymentSummaryForRange,
} from './network-v2-payment-summary.util';

const FS_SUMMARY_CONFIG = {
  summaryUrl: 'https://api.famesta.com/api/payment_summary',
  source: 'famesta',
  networkLabel: 'Famesta',
};

export const fetchFamestaPaymentSummary = (
  token: string,
  rangeBegin: string,
  rangeEnd: string,
) => fetchNetworkV2PaymentSummaryForRange(FS_SUMMARY_CONFIG, token, rangeBegin, rangeEnd);

export const aggregateFamestaPaymentSummaryForSettlement =
  aggregateNetworkV2PaymentSummaryForSettlement;
