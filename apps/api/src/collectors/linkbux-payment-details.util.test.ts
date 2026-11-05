import assert from 'node:assert/strict';
import {
  aggregateLinkbuxActualCommissionsForSettlement,
  aggregateLinkbuxReceivableCommissionsForSettlement,
  aggregateLinkbuxReceivableUnpaidByPaymentId,
  type LinkbuxMerchantCommissionRow,
} from './linkbux-payment-details.util';

function runTests() {
  const month = '2026-11';
  const unpaid: LinkbuxMerchantCommissionRow[] = [
    {
      sale_comm: '100',
      settlement_date: '11-05-2026',
      payment_id: 18540,
      paid_date: null,
    },
    {
      sale_comm: '50',
      settlement_date: '2026-11-20',
      payment_id: null,
      paid_date: null,
    },
  ];
  const recv = aggregateLinkbuxReceivableCommissionsForSettlement(unpaid, month);
  assert.equal(recv.receivableH1, 100);
  assert.equal(recv.receivableH2, 50);

  const paid: LinkbuxMerchantCommissionRow[] = [
    {
      sale_comm: '2238.59',
      settlement_date: '2026-10-01',
      payment_id: 18413,
      paid_date: '2026-10-20',
    },
  ];
  const oct = aggregateLinkbuxActualCommissionsForSettlement(paid, '2026-10');
  assert.equal(oct.actualH2, 2238.59);
  const novActual = aggregateLinkbuxActualCommissionsForSettlement(paid, month);
  assert.equal(novActual.actualH1 + novActual.actualH2, 0);

  const pendingBatch: LinkbuxMerchantCommissionRow[] = [
    {
      sale_comm: '1,155.60',
      settlement_date: '10-15-2026',
      payment_id: 18540,
      paid_date: null,
    },
  ];
  const pendingRecv = aggregateLinkbuxReceivableCommissionsForSettlement(pendingBatch, month);
  assert.equal(pendingRecv.receivableH1, 1155.6);

  const batch = aggregateLinkbuxReceivableUnpaidByPaymentId(
    [
      { sale_comm: '100', payment_id: 18540, paid_date: null },
      { sale_comm: '1055.60', payment_id: 18540, paid_date: null },
    ],
    month,
  );
  assert.equal(batch.receivableH1, 1155.6);

  console.log('linkbux-payment-details.util.test.ts: ok');
}

runTests();
