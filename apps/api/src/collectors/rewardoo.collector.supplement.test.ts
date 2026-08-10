import assert from 'node:assert/strict';
import {
  buildRwSupplementMerchantsByDate,
  listRwSupplementMerchantIds,
  rwDetailMetricsNeedApiSupplement,
} from './rewardoo.collector';

const detailMetrics = [
  {
    merchantId: '100',
    clickDate: '2026-08-05',
    performanceOrders: 2,
    performanceCommission: 10,
    clicks: 0,
  },
];

const normalized = [
  { merchantId: '100', orderDate: new Date('2026-08-05T00:00:00.000Z') },
  { merchantId: '200', orderDate: new Date('2026-08-06T00:00:00.000Z') },
];

assert.equal(rwDetailMetricsNeedApiSupplement(detailMetrics, normalized), true);

const gaps = buildRwSupplementMerchantsByDate(detailMetrics, normalized);
assert.equal(gaps.size, 1);
assert.equal(gaps.get('2026-08-06')?.has('200'), true);
assert.notEqual(gaps.get('2026-08-06')?.has('100'), true);

const mids = listRwSupplementMerchantIds(gaps);
assert.deepEqual(mids, ['200']);

console.log('rewardoo.collector supplement: ok');
