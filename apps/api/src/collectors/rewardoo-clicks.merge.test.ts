import assert from 'node:assert/strict';
import { mergeRwPerformancePreferApiDaily } from './rewardoo-clicks';

function runTests() {
  const merged = mergeRwPerformancePreferApiDaily(
    [
      {
        merchantId: '123',
        merchantName: 'Halfords',
        clickDate: '2026-07-27',
        performanceOrders: 7,
        performanceCommission: 11.88,
        clicks: 0,
      },
    ],
    [
      {
        merchantId: '123',
        merchantName: 'Halfords',
        clickDate: '2026-07-27',
        performanceOrders: 7,
        performanceCommission: 10.0,
        clicks: 61,
      },
    ],
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].performanceOrders, 7);
  assert.equal(merged[0].clicks, 61);
  assert.equal(merged[0].performanceCommission, 11.88);
  console.log('mergeRwPerformancePreferApiDaily: ok');
}

runTests();
