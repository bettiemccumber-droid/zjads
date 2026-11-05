import assert from 'node:assert/strict';
import {
  aggregateLinkbuxPaymentsForSettlement,
  parseLinkbuxPaymentDate,
  type LinkbuxPaymentRow,
} from './linkbux-payments.util';

function runTests() {
  const row: LinkbuxPaymentRow = {
    payment_id: 18540,
    amount: '1,155.60',
    status: 'Pending',
    date: '11-05-2026',
  };
  assert.equal(parseLinkbuxPaymentDate(row), '2026-11-05');

  const agg = aggregateLinkbuxPaymentsForSettlement([row], '2026-11');
  assert.equal(agg.receivableH1, 1155.6);
  assert.equal(agg.receivableH2, 0);
  assert.equal(agg.actualH1, 0);

  const paid: LinkbuxPaymentRow = {
    payment_id: 18413,
    amount: 2238.59,
    status: 'Paid',
    date: '10-20-2026',
    paid_date: '2026-10-20',
  };
  const oct = aggregateLinkbuxPaymentsForSettlement([paid], '2026-10');
  assert.equal(oct.actualH2, 2238.59);

  console.log('linkbux-payments.util.test.ts: ok');
}

runTests();
