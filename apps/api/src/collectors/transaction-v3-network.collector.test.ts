import assert from 'node:assert/strict';

import { resolveClickReportMerchantId } from './network-family-clicks';
import {
  normalizeNetworkV3Orders,
  resolveNetworkV3MerchantId,
  summarizeNetworkV3TransactionApi,
} from './transaction-v3-network.collector';

function runTests() {
  assert.equal(resolveNetworkV3MerchantId({ mid: 8000647, mcid: 'nydj' }), '8000647');
  assert.equal(resolveNetworkV3MerchantId({ mid: 0, mcid: 'audioengine' }), 'audioengine');

  assert.equal(resolveClickReportMerchantId({ brand_id: 66303 }), '66303');
  assert.equal(resolveClickReportMerchantId({ brand_id: 0, mcid: 'ulike0' }), 'ulike0');

  const orders = [
    {
      oid: 'ny12710_114c999c6853e3a4790e5bec04803135',
      mid: 8000647,
      mcid: 'nydj',
      merchant_name: 'NYDJ',
      order_time: '2024-02-08 22:13:59',
      items: [{ sale_amount: '0', sale_comm: '0', status: 'Rejected' }],
    },
    {
      oid: 'au19191_8a6d98e87d778e2d85f3fe3a970513bd',
      mid: 0,
      mcid: 'audioengine',
      order_time: '2024-01-18 03:34:08',
      items: [
        { sale_amount: '399', sale_comm: '27.93', status: 'Pending' },
        { sale_amount: '399', sale_comm: '27.93', status: 'Pending' },
      ],
    },
  ];

  const normalized = normalizeNetworkV3Orders(orders, []);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[1].merchantId, 'audioengine');
  assert.equal(normalized[1].commission, 55.86);

  const summary = summarizeNetworkV3TransactionApi(orders);
  assert.equal(summary.apiListRows, 2);
  assert.equal(summary.orderCount, 2);
  assert.equal(summary.totalCommission, 55.86);

  console.log('transaction-v3-network.collector.test OK');
}

runTests();
