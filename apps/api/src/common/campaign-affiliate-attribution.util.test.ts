import assert from 'node:assert/strict';
import {
  affiliateAliasSamePlatformFamily,
  aggregateAffiliateMetricsByFamily,
  aggregateAffiliateMetricsByFamilyForDay,
  campaignAffiliateAttributionKey,
  campaignCoversMerchantAffiliate,
  isOrphanAffiliateCampaign,
  sumDailyAffiliateAttributionByCampaignKey,
} from './campaign-affiliate-attribution.util';

function runTests() {
  assert.equal(campaignAffiliateAttributionKey('159854', 'ui1'), 'ui:159854');
  assert.equal(campaignAffiliateAttributionKey('159854', 'ui2'), 'ui:159854');
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh5'), 'lh:159854');
  assert.equal(campaignAffiliateAttributionKey('159854', 'lh6'), 'lh:159854');
  assert.equal(campaignAffiliateAttributionKey('66303', 'bsh5'), 'bsh:66303');
  assert.equal(campaignAffiliateAttributionKey('66303', 'bsh1'), 'bsh:66303');
  assert.equal(campaignAffiliateAttributionKey('66303', 'bsp1'), 'bsh:66303');
  assert.equal(affiliateAliasSamePlatformFamily('ui1', 'ui2'), true);
  assert.equal(affiliateAliasSamePlatformFamily('bsh5', 'bsh1'), true);
  assert.equal(affiliateAliasSamePlatformFamily('bsh5', 'bsp1'), true);
  assert.equal(affiliateAliasSamePlatformFamily('bsh5', 'cg1'), false);
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
    ['87590|lh1', { orderCount: 0, commission: 0, affiliateClicks: 0, rejectedCommission: 0 }],
    ['87590|pm1', { orderCount: 1, commission: 25.47, affiliateClicks: 3, rejectedCommission: 0 }],
    ['66303|bsh5', { orderCount: 2, commission: 10, affiliateClicks: 5, rejectedCommission: 1 }],
  ]);
  const pmOnly = aggregateAffiliateMetricsByFamily(byKey, '87590', 'pm');
  assert.equal(pmOnly.orderCount, 1);
  assert.equal(pmOnly.commission, 25.47);
  const lhOnly = aggregateAffiliateMetricsByFamily(byKey, '87590', 'lh');
  assert.equal(lhOnly.orderCount, 0);
  assert.equal(lhOnly.commission, 0);
  const bshOnly = aggregateAffiliateMetricsByFamily(byKey, '66303', 'bsh');
  assert.equal(bshOnly.orderCount, 2);
  assert.equal(bshOnly.commission, 10);
  assert.equal(bshOnly.rejectedCommission, 1);

  const byDay = new Map([
    ['87590|pm1|2026-07-18', { orderCount: 1, commission: 25.47, affiliateClicks: 1, rejectedCommission: 0 }],
    ['87590|lh1|2026-07-18', { orderCount: 0, commission: 0, affiliateClicks: 0, rejectedCommission: 0 }],
  ]);
  const pmDay = aggregateAffiliateMetricsByFamilyForDay(byDay, '87590', 'pm', '2026-07-18');
  assert.equal(pmDay.commission, 25.47);

  assert.equal(isOrphanAffiliateCampaign('orphan|87590|pm1', 'Sun & Snow（无 Sheet 系列 · pm1）'), true);
  assert.equal(isOrphanAffiliateCampaign('123', '149-lh1-sunandsnow-pl-0612-87590'), false);

  // 同商家新旧系列：按日归因后再加总，两边都能拿到各自日期的佣金
  const summed = sumDailyAffiliateAttributionByCampaignKey([
    {
      campaignGroupKey: 'old',
      orderCount: 2,
      commission: 100,
      affiliateClicks: 5,
      rejectedCommission: 1,
    },
    {
      campaignGroupKey: 'new',
      orderCount: 9,
      commission: 41.91,
      affiliateClicks: 3,
      rejectedCommission: 0,
    },
    {
      campaignGroupKey: 'old',
      orderCount: 1,
      commission: 44.39,
      affiliateClicks: 2,
      rejectedCommission: 0,
    },
    {
      campaignGroupKey: 'new',
      orderCount: 0,
      commission: 0,
      affiliateClicks: 0,
      rejectedCommission: 0,
    },
  ]);
  assert.equal(summed.get('old')?.commission, 144.39);
  assert.equal(summed.get('old')?.orderCount, 3);
  assert.equal(summed.get('new')?.commission, 41.91);
  assert.equal(summed.get('new')?.orderCount, 9);
  assert.equal(summed.get('new')?.rejectedCommission, 0);

  console.log('campaign-affiliate-attribution.util.test.ts: all passed');
}

runTests();
