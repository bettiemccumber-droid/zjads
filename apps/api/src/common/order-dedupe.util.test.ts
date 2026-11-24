import assert from 'node:assert/strict';
import {
  affiliateOrderMetricsDedupeKey,
  dedupeAffiliateOrderRecord,
  shouldAccumulateCommissionOnDedupeHit,
} from './order-dedupe.util';

assert.equal(
  affiliateOrderMetricsDedupeKey({
    channelAccountId: 10,
    externalOrderId: 'LH-ORDER-1',
    channelAccount: { platform: { code: 'linkhaitao' } },
  }),
  affiliateOrderMetricsDedupeKey({
    channelAccountId: 20,
    externalOrderId: 'LH-ORDER-1',
    channelAccount: { platform: { code: 'linkhaitao' } },
  }),
  'LH 不同渠道账号同一单号应撞同一去重键',
);

assert.notEqual(
  affiliateOrderMetricsDedupeKey({
    channelAccountId: 10,
    externalOrderId: 'RW-1',
    channelAccount: { platform: { code: 'rewardoo' } },
  }),
  affiliateOrderMetricsDedupeKey({
    channelAccountId: 20,
    externalOrderId: 'RW-1',
    channelAccount: { platform: { code: 'rewardoo' } },
  }),
  'RW 仍按渠道账号隔离',
);

assert.equal(shouldAccumulateCommissionOnDedupeHit('linkhaitao'), false);
assert.equal(shouldAccumulateCommissionOnDedupeHit('partnermatic'), true);
assert.equal(dedupeAffiliateOrderRecord({ externalOrderId: 'plain-1' }), 'plain-1');

console.log('order-dedupe.util.test.ts: ok');
