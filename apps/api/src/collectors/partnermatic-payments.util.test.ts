import assert from 'node:assert/strict';
import {
  aggregateNetworkV2PaymentSummaryForSettlement,
  type NetworkV2PaymentSummaryRow,
} from './network-v2-payment-summary.util';

function runTests() {
  const inProgress: NetworkV2PaymentSummaryRow = {
    payment_id: 10001,
    amount: 555.68,
    status: 'processing',
    request_date: '2026-11-05 01:13:24',
  };
  const nov = aggregateNetworkV2PaymentSummaryForSettlement([inProgress], '2026-11');
  assert.equal(nov.receivableH1, 555.68);
  assert.equal(nov.actualH1, 0);

  console.log('partnermatic-payments.util.test.ts: ok');
}

runTests();
