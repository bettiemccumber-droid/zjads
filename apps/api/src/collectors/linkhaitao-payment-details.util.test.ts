import assert from 'node:assert/strict';
import {
  aggregateNetworkV2PaymentDetailsForSettlement,
  type NetworkV2PaymentDetailRow,
} from './network-v2-payment-details.util';

function runTests() {
  const month = '2024-09';
  const paidRows: NetworkV2PaymentDetailRow[] = [
    { amount: 10, paid_date: '2024-09-05', payment_id: 1, validation_date: '2024-08-01' },
    { amount: 20, paid_date: '2024-09-20', payment_id: 2, validation_date: '2024-08-15' },
  ];
  const validationRows: NetworkV2PaymentDetailRow[] = [
    { amount: 5, validation_date: '2024-09-10', payment_id: null, paid_date: null, sign_id: 'a' },
    { amount: 7, validation_date: '2024-09-18', payment_id: null, paid_date: null, sign_id: 'b' },
    { amount: 99, validation_date: '2024-09-12', payment_id: 3, paid_date: '2024-09-12' },
  ];

  const agg = aggregateNetworkV2PaymentDetailsForSettlement(paidRows, validationRows, month);
  assert.equal(agg.actualH1, 10);
  assert.equal(agg.actualH2, 20);
  assert.equal(agg.receivableH1, 5);
  assert.equal(agg.receivableH2, 7);

  console.log('linkhaitao-payment-details.util.test.ts: ok');
}

runTests();
