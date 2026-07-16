import assert from 'node:assert/strict';
import {
  affiliateAliasSamePlatformFamily,
  campaignAffiliateAttributionKey,
  campaignCoversMerchantAffiliate,
} from './campaign-affiliate-attribution.util';

function runTests() {
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh5'), 'lh:159854');
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh6'), 'lh:159854');
  assert.notEqual(
    campaignAffiliateAttributionKey('159854', 'lh5'),
    campaignAffiliateAttributionKey('159854', 'lb3'),
  );

  assert.equal(affiliateAliasSamePlatformFamily('lh5', 'lh6'), true);
  assert.equal(affiliateAliasSamePlatformFamily('lh5', 'lb3'), false);

  const campaigns = [{ merchantId: '159854', affiliateAlias: 'lh6' }];
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '159854', 'lh5'), true);
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '159854', 'lb3'), false);
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '999', 'lh5'), false);

  console.log('campaign-affiliate-attribution.util.test.ts: all passed');
}

runTests();
