import assert from 'node:assert/strict';
import { MerchantCommissionAgg } from './commission-aggregate.util';
import {
  aggregateRwPerformanceByMerchant,
  applyRwPerformanceCommissionOverlay,
  rwMerchantAggKey,
} from './rw-performance-settlement.util';

function baseMerchant(overrides: Partial<MerchantCommissionAgg> = {}): MerchantCommissionAgg {
  return {
    merchantId: '122309',
    merchantName: 'Test Merchant',
    platformCode: 'rewardoo',
    platformName: 'Rewardoo',
    affiliateAlias: 'rw3',
    orderCount: 32,
    rejectedOrderCount: 0,
    totalCommission: 336.13,
    confirmedCommission: 0,
    pendingCommission: 336.13,
    rejectedCommission: 0,
    rejectionRate: 0,
    ...overrides,
  };
}

function runTests() {
  const key = rwMerchantAggKey('122309', 'rw3');
  assert.equal(key, '122309|rewardoo|rw3');

  const perfByKey = aggregateRwPerformanceByMerchant([
    {
      merchantId: '122309',
      merchantName: 'Test Merchant',
      performanceOrders: 20,
      performanceCommission: 200,
      channelAccount: {
        affiliateAlias: 'rw3',
        platform: { code: 'rewardoo', name: 'Rewardoo' },
      },
    },
    {
      merchantId: '122309',
      merchantName: 'Test Merchant',
      performanceOrders: 20,
      performanceCommission: 145.39,
      channelAccount: {
        affiliateAlias: 'rw3',
        platform: { code: 'rewardoo', name: 'Rewardoo' },
      },
    },
  ]);

  assert.equal(perfByKey.get(key)?.orderCount, 40);
  assert.equal(perfByKey.get(key)?.totalCommission, 345.39);

  const overlaid = applyRwPerformanceCommissionOverlay([baseMerchant()], perfByKey);
  assert.equal(overlaid.length, 1);
  assert.equal(overlaid[0].orderCount, 40);
  assert.equal(overlaid[0].totalCommission, 345.39);
  assert.equal(overlaid[0].pendingCommission, 345.39);

  const withNewMerchant = applyRwPerformanceCommissionOverlay([], perfByKey);
  assert.equal(withNewMerchant.length, 1);
  assert.equal(withNewMerchant[0].totalCommission, 345.39);

  console.log('rw-performance-settlement.util.test.ts: all passed');
}

runTests();
