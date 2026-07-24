import assert from 'node:assert/strict';

import {
  normalizeUltraInfluenceOrders,
  resolveUiMerchantId,
  summarizeUiTransactionApi,
} from './ultrainfluence.collector';

function runTests() {
  assert.equal(resolveUiMerchantId({ mid: 8000647, mcid: 'nydj' }), '8000647');
  assert.equal(resolveUiMerchantId({ mid: 0, mcid: 'audioengine' }), 'audioengine');

  const orders = [
    {
      oid: 'ny12710_114c999c6853e3a4790e5bec04803135',
      mid: 8000647,
      mcid: 'nydj',
      merchant_name: 'NYDJ',
      order_id: '1271028',
      order_time: '2024-02-08 22:13:59',
      items: [
        {
          ultrainfluence_id: 'a0a080f42e6f13b3a2df133f073095dd',
          sale_amount: '0',
          sale_comm: '0',
          status: 'Rejected',
          prod_id: '889982520597',
        },
      ],
    },
    {
      oid: 'au19191_8a6d98e87d778e2d85f3fe3a970513bd',
      mid: 0,
      mcid: 'audioengine',
      order_id: '19191.5860.491317',
      order_time: '2024-01-18 03:34:08',
      items: [
        {
          ultrainfluence_id: '497d0b20f66cebdedc7935e3ffd46efa',
          sale_amount: '399',
          sale_comm: '27.93',
          status: 'Pending',
          prod_id: 'speaker',
        },
        {
          ultrainfluence_id: '671f0311e2754fcdd37f70a8550379bc',
          sale_amount: '399',
          sale_comm: '27.93',
          status: 'Pending',
          prod_id: 'speaker',
        },
      ],
    },
  ];

  const normalized = normalizeUltraInfluenceOrders(orders, []);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].externalOrderId, 'ny12710_114c999c6853e3a4790e5bec04803135');
  assert.equal(normalized[0].merchantId, '8000647');
  assert.equal(normalized[0].commission, 0);
  assert.equal(normalized[1].merchantId, 'audioengine');
  assert.equal(normalized[1].commission, 55.86);
  assert.equal(normalized[1].orderDate.toISOString().slice(0, 10), '2024-01-18');

  const summary = summarizeUiTransactionApi(orders);
  assert.equal(summary.apiListRows, 2);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.totalCommission, 55.86);

  console.log('ultrainfluence.collector.test.ts: all passed');
}

runTests();
