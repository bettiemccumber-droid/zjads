import assert from 'node:assert/strict';
import {
  affiliateAliasSamePlatformFamily,
  aggregateAffiliateMetricsByFamily,
  aggregateAffiliateMetricsByFamilyForDay,
  campaignAffiliateAttributionKey,
  campaignCoversMerchantAffiliate,
  isOrphanAffiliateCampaign,
} from './campaign-affiliate-attribution.util';

function runTests() {
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh5'), 'lh:159854');
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh6'), 'lh:159854');
  assert.notEqual(
    campaignAffiliateAttributionKey('87590', 'lh1'),
    campaignAffiliateAttributionKey('87590', 'pm1'),
  );

  assert.equal(affiliateAliasSamePlatformFamily('lh5', 'lh6'), true);
  assert.equal(affiliateAliasSamePlatformFamily('lh5', 'lb3'), false);

  const campaigns = [{ merchantId: '159854', affiliateAlias: 'lh6' }];
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '159854', 'lh5'), true);
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '159854', 'lb3'), false);
  assert.equal(campaignCoversMerchantAffiliate(campaigns, '999', 'lh5'), false);

  const pmCampaigns = [{ merchantId: '126667', affiliateAlias: 'pm5' }];
  assert.equal(campaignCoversMerchantAffiliate(pmCampaigns, '126667', 'pm5'), true);

  const byKey = new Map([
    ['87590|lh1', { orderCount: 0, commission: 0, affiliateClicks: 0 }],
    ['87590|pm1', { orderCount: 1, commission: 25.47, affiliateClicks: 3 }],
  ]);
  const pmOnly = aggregateAffiliateMetricsByFamily(byKey, '87590', 'pm');
  assert.equal(pmOnly.orderCount, 1);
  assert.equal(pmOnly.commission, 25.47);
  const lhOnly = aggregateAffiliateMetricsByFamily(byKey, '87590', 'lh');
  assert.equal(lhOnly.orderCount, 0);
  assert.equal(lhOnly.commission, 0);

  const byDay = new Map([
    ['87590|pm1|2026-07-18', { orderCount: 1, commission: 25.47, affiliateClicks: 1 }],
    ['87590|lh1|2026-07-18', { orderCount: 0, commission: 0, affiliateClicks: 0 }],
  ]);
  const pmDay = aggregateAffiliateMetricsByFamilyForDay(byDay, '87590', 'pm', '2026-07-18');
  assert.equal(pmDay.commission, 25.47);

  assert.equal(isOrphanAffiliateCampaign('orphan|87590|pm1', 'Sun & Snow（无 Sheet 系列 · pm1）'), true);
  assert.equal(isOrphanAffiliateCampaign('123', '149-lh1-sunandsnow-pl-0612-87590'), false);

  console.log('campaign-affiliate-attribution.util.test.ts: all passed');
}

runTests();
