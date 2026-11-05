import assert from 'node:assert/strict';
import {
  aggregateRewardooPaymentsForSettlement,
  type RewardooPaymentRow,
} from './rewardoo-payments.util';

function runTests() {
  const inProgress: RewardooPaymentRow = {
    withdrawal_id: 9001,
    status: 'processing',
    commission: 161.1,
    request_date: '2026-11-05',
    update_time: '2026-11-05 00:06:56',
  };
  const nov = aggregateRewardooPaymentsForSettlement([inProgress], '2026-11');
  assert.equal(nov.receivableH1, 161.1);
  assert.equal(nov.actualH1, 0);

  const paid: RewardooPaymentRow = {
    withdrawal_id: 8247498,
    status: 'withdrawn',
    commission: 359.51,
    request_date: '2026-10-15',
    paid_date: '2026-10-21',
  };
  const oct = aggregateRewardooPaymentsForSettlement([paid], '2026-10');
  assert.equal(oct.actualH2, 359.51);
  const novFromPaid = aggregateRewardooPaymentsForSettlement([paid], '2026-11');
  assert.equal(novFromPaid.actualH1 + novFromPaid.actualH2, 0);

  console.log('rewardoo-payments.util.test.ts: ok');
}

runTests();
