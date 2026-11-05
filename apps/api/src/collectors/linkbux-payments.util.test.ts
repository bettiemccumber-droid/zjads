import assert from 'node:assert/strict';
import {
  aggregateLinkbuxPaymentsForSettlement,
  type LinkbuxPaymentRow,
} from './linkbux-payments.util';

function runTests() {
  const pending: LinkbuxPaymentRow = {
    payment_id: 18540,
    date: '11-05-2026',
    amount: 1155.6,
    status: 'Pending',
  };
  const nov = aggregateLinkbuxPaymentsForSettlement([pending], '2026-11');
  assert.equal(nov.receivableH1, 1155.6);
  assert.equal(nov.actualH1, 0);

  const paid: LinkbuxPaymentRow = {
    payment_id: 18413,
    date: '10-20-2026',
    paid_date: '10-20-2026',
    amount: 2238.59,
    status: 'Paid',
  };
  const oct = aggregateLinkbuxPaymentsForSettlement([paid], '2026-10');
  assert.equal(oct.actualH2, 2238.59);

  console.log('linkbux-payments.util.test.ts: ok');
}

runTests();
