import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  fetchNetworkV2PaymentSummaryForRange,
} from './network-v2-payment-summary.util';

const BSH_SUMMARY_CONFIG = {
  summaryUrl: 'https://api.brandsparkhub.com/api/payment_summary',
  source: 'brandsparkhub',
  networkLabel: 'Brandsparkhub',
};

export const fetchBrandsparkhubPaymentSummary = (
  token: string,
  rangeBegin: string,
  rangeEnd: string,
) => fetchNetworkV2PaymentSummaryForRange(BSH_SUMMARY_CONFIG, token, rangeBegin, rangeEnd);

export const aggregateBrandsparkhubPaymentSummaryForSettlement =
  aggregateNetworkV2PaymentSummaryForSettlement;
