import {
  buildRwSupplementMerchantsByDate,
  listRwSupplementMerchantIds,
  rwDetailMetricsNeedApiSupplement,
} from './rewardoo.collector';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

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

assert(rwDetailMetricsNeedApiSupplement(detailMetrics, normalized), 'should need supplement');

const gaps = buildRwSupplementMerchantsByDate(detailMetrics, normalized);
assert(gaps.size === 1, 'one gap date');
assert(gaps.get('2026-08-06')?.has('200'), 'merchant 200 on 2026-08-06');
assert(!gaps.get('2026-08-06')?.has('100'), 'merchant 100 should not be in gaps');

const mids = listRwSupplementMerchantIds(gaps);
assert(mids.length === 1 && mids[0] === '200', 'only merchant 200');

console.log('rewardoo.collector supplement: ok');
