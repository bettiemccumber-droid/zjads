import assert from 'node:assert/strict';
import {
  buildRwSupplementMerchantsByDate,
  fillRwPerformanceGapsFromNormalizedOrders,
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
    merchantName: 'A',
  },
];

const normalized = [
  {
    merchantId: '100',
    merchantName: 'A',
    orderDate: new Date('2026-08-05T00:00:00.000Z'),
    commission: 10,
  },
  {
    merchantId: '200',
    merchantName: 'B',
    orderDate: new Date('2026-08-06T00:00:00.000Z'),
    commission: 5,
  },
];

assert.equal(rwDetailMetricsNeedApiSupplement(detailMetrics, normalized), true);

const gaps = buildRwSupplementMerchantsByDate(detailMetrics, normalized);
assert.equal(gaps.size, 1);
assert.equal(gaps.get('2026-08-06')?.has('200'), true);

const filled = fillRwPerformanceGapsFromNormalizedOrders(detailMetrics, normalized, gaps);
assert.equal(rwDetailMetricsNeedApiSupplement(filled, normalized), false);
assert.equal(filled.find((m) => m.merchantId === '200')?.performanceOrders, 1);

const mids = listRwSupplementMerchantIds(gaps);
assert.deepEqual(mids, ['200']);

console.log('rewardoo.collector supplement: ok');
