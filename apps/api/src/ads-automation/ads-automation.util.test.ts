import assert from 'assert';
import {
  buildAttachCampaignImagePayload,
  buildCreateCampaignPayload,
  describeMediaAttachResult,
} from './mutate-payload';
import {
  affiliateKeywordDensity,
  annotateAffiliateKeywords,
  buildCampaignName,
  buildSampleDraft,
  buildTrackUrl,
  isCustomerEligible,
  isMerchantHomepageUrl,
  reviewDraftGate,
  softenExcessiveUppercase,
  suggestStructuredSnippetsForMerchant,
  usdToMicros,
  validateDraft,
} from './ads-automation.util';

const airlineSnippets = suggestStructuredSnippetsForMerchant({
  merchantName: 'Vietnam Airlines',
  merchantUrl: 'https://www.vietnamairlines.com/',
});
assert.deepStrictEqual(
  airlineSnippets.map((row) => row.header),
  ['Destinations', 'Types'],
  '航司应优先 Destinations + Types',
);
const fashionSnippets = suggestStructuredSnippetsForMerchant({
  merchantName: 'AG Jeans Outlet',
  merchantUrl: 'https://www.agjeansoutlet.com/',
});
assert.ok(fashionSnippets.some((row) => row.header === 'Styles' || row.header === 'Types'));

const draft = buildSampleDraft({
  merchantName: 'AG Jeans Outlet',
  merchantUrl: 'https://www.agjeansoutlet.com/',
  countryCode: 'US',
  languageCode: 'en',
});
assert.ok(
  !draft.structuredSnippets.every((row) => row.header === 'Types' || row.header === 'Styles')
    || draft.structuredSnippets.some((row) => row.header === 'Styles'),
  '服饰样例应偏向 Styles/Types，而非固定 Brands 占位',
);
const withVerifiedSitelinks = <T extends { sitelinks: Array<{ verified: boolean }> }>(value: T): T => ({
  ...value,
  sitelinks: value.sitelinks.map((link) => ({ ...link, verified: true })),
});

assert.deepStrictEqual(validateDraft(withVerifiedSitelinks(draft)), []);
assert.strictEqual(usdToMicros('3.00'), '3000000');
assert.strictEqual(usdToMicros('0.50'), '500000');
assert.strictEqual(
  buildCampaignName({
    sequence: 2007,
    platformCode: 'BSH1',
    merchantName: 'AG Jeans Outlet',
    countryCode: 'US',
    mid: '1865558',
    now: new Date('2026-11-12T02:00:00.000Z'),
  }),
  '2007-bsh1-AGJeansOutlet-US-1112-1865558',
);
assert.strictEqual(
  buildTrackUrl('partnermatic', 'https://bellroy.com/'),
  'https://app.partnermatic.com/track/?url=https%3A%2F%2Fbellroy.com%2F',
);

const payload = buildCreateCampaignPayload({
  customerId: '130-512-5178',
  campaignName: '2007-BSH1-AGJeansOutlet-US-1112-1865558',
  draft,
});
const operations = payload.mutateOperations as Array<Record<string, { create: Record<string, unknown> }>>;
const campaignOp = operations.find((item) => item.campaignOperation);
assert.deepStrictEqual(
  (campaignOp?.campaignOperation.create as { geoTargetTypeSetting?: unknown }).geoTargetTypeSetting,
  { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
  '地理定向默认「所在地」而非「所在地或兴趣」',
);
const ad = operations.find((item) => item.adGroupAdOperation);
assert.deepStrictEqual(ad?.adGroupAdOperation.create.ad, {
  finalUrls: ['https://www.agjeansoutlet.com/'],
  responsiveSearchAd: {
    headlines: draft.headlines.map((text) => ({ text })),
    descriptions: draft.descriptions.map((text) => ({ text })),
  },
});
assert.strictEqual(
  isCustomerEligible({
    googleStatus: 'SUSPENDED',
    availability: 'available',
    currencyCode: 'USD',
    timeZone: 'Asia/Shanghai',
  }),
  false,
);

const tooLong = withVerifiedSitelinks({ ...draft, headlines: ['x'.repeat(31), 'ab', 'cd'] });
assert.ok(validateDraft(tooLong).length > 0);

assert.strictEqual(softenExcessiveUppercase('SHOPNOW Today'), 'Shopnow Today');
assert.strictEqual(softenExcessiveUppercase('BEST DEALS'), 'BEST Deals');
assert.strictEqual(softenExcessiveUppercase('FREE'), 'FREE');
const allCaps = withVerifiedSitelinks({ ...draft, headlines: ['SHOPNOW Official', 'Shop Brand', 'Visit Store'] });
assert.ok(validateDraft(allCaps).some((msg) => /连续大写/.test(msg)));
assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({ ...draft, headlines: ['FREE Shipping', 'Shop Brand', 'Visit Store'] })),
  [],
);

assert.ok(isMerchantHomepageUrl('https://www.vietnamairlines.com/', 'https://www.vietnamairlines.com/vn/vi/home'));
assert.ok(isMerchantHomepageUrl('https://www.vietnamairlines.com/vn/vi/home', 'https://www.vietnamairlines.com/vn/vi/home'));
assert.ok(!isMerchantHomepageUrl('https://www.vietnamairlines.com/vn/en/book', 'https://www.vietnamairlines.com/vn/vi/home'));

const missingHomepage = withVerifiedSitelinks({
  ...draft,
  sitelinks: draft.sitelinks.map((link, index) => ({
    ...link,
    finalUrl: `https://www.agjeansoutlet.com/shop-${index + 1}`,
    verified: true,
  })),
});
assert.ok(validateDraft(missingHomepage).some((msg) => /官网/.test(msg)));

assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({ ...draft, sitelinks: [] })),
  [],
  '全删站内链接仍可提交',
);
assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({ ...draft, callouts: [], structuredSnippets: [] })),
  [],
  '宣传信息与结构化摘要可为空',
);
assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({ ...draft, businessName: '' })),
  [],
  '商家名称可留空提交',
);
assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({ ...draft, businessName: 'ABC HOME FURNITURE' })),
  [],
  '商家名称允许全大写品牌名',
);
assert.ok(
  validateDraft(withVerifiedSitelinks({ ...draft, businessName: 'x'.repeat(26) })).some((msg) => /商家名称/.test(msg)),
  '商家名称超长应拦截',
);
assert.ok(
  draft.businessName && draft.businessName.length <= 25,
  '样例草稿默认带上截断后的商家名称',
);
const withBusiness = buildCreateCampaignPayload({
  customerId: '130-512-5178',
  campaignName: 'test-business-name',
  draft: { ...draft, businessName: 'Vietnam Airlines' },
});
const businessOps = (withBusiness.mutateOperations as Array<Record<string, unknown>>)
  .filter((item) => item.assetOperation || item.campaignAssetOperation);
assert.ok(
  businessOps.some((item) => {
    const create = (item.assetOperation as { create?: { textAsset?: { text?: string } } } | undefined)?.create;
    return create?.textAsset?.text === 'Vietnam Airlines';
  }),
  '有商家名称时应创建 textAsset',
);
assert.ok(
  businessOps.some((item) => {
    const create = (item.campaignAssetOperation as { create?: { fieldType?: string } } | undefined)?.create;
    return create?.fieldType === 'BUSINESS_NAME';
  }),
  '商家名称应以 BUSINESS_NAME 挂到系列',
);
const withoutBusiness = buildCreateCampaignPayload({
  customerId: '130-512-5178',
  campaignName: 'test-no-business-name',
  draft: { ...draft, businessName: '' },
});
assert.ok(
  !(withoutBusiness.mutateOperations as Array<Record<string, unknown>>).some((item) => {
    const create = (item.campaignAssetOperation as { create?: { fieldType?: string } } | undefined)?.create;
    return create?.fieldType === 'BUSINESS_NAME';
  }),
  '空商家名称不提交 BUSINESS_NAME 资产',
);
assert.deepStrictEqual(
  validateDraft(withVerifiedSitelinks({
    ...draft,
    structuredSnippets: [{ header: 'Types', values: ['A', 'B'] }],
  })),
  [],
  '结构化摘要不强制条数与最少值个数',
);

const plainArticle = {
  title: 'Koia drinks',
  intro: [
    'I tried Koia on a busy Monday. Koia protein shakes were easy to pack.',
    'Friends asked about Koia after seeing my bottle.',
  ],
  sections: [
    {
      heading: 'Taste',
      paragraphs: [
        'Koia tastes clean. I keep Koia in the fridge and grab Koia before workouts.',
        'Would I buy Koia again? Yes, Koia fits my routine.',
      ],
    },
    {
      heading: 'Next',
      paragraphs: ['Shop Koia if you want a simple shake. Visit Koia for flavors.'],
    },
  ],
};
const linked = annotateAffiliateKeywords(plainArticle, 'Koia');
const density = affiliateKeywordDensity(linked);
assert.ok(density.keywords.length >= 2);
assert.ok(density.ratio >= 0.05);
assert.ok(linked.intro.join(' ').includes('[[affiliate:'));

const attachPayload = buildAttachCampaignImagePayload({
  customerId: '130-512-5178',
  campaignResource: 'customers/1305125178/campaigns/99',
  image: { name: 'ad-image-1', data: 'abc123' },
  fieldType: 'AD_IMAGE',
  tempAssetId: -301,
});
const attachOps = attachPayload.mutateOperations as Array<Record<string, unknown>>;
assert.strictEqual(attachOps.length, 2);
assert.deepStrictEqual(
  (attachOps[0] as { assetOperation: { create: { resourceName: string } } }).assetOperation.create.resourceName,
  'customers/1305125178/assets/-301',
);
assert.deepStrictEqual(
  (attachOps[1] as { campaignAssetOperation: { create: { campaign: string; fieldType: string } } })
    .campaignAssetOperation.create,
  {
    asset: 'customers/1305125178/assets/-301',
    campaign: 'customers/1305125178/campaigns/99',
    fieldType: 'AD_IMAGE',
  },
);
assert.strictEqual(describeMediaAttachResult({ attached: 3, skipped: 0 }), '图片/商标已补挂 3 张');
assert.strictEqual(describeMediaAttachResult({ attached: 2, skipped: 1 }), '已挂 2 张图片/商标，跳过 1 张');
assert.strictEqual(describeMediaAttachResult({ attached: 0, skipped: 4 }), '图片/商标未挂上（跳过 4 张）');

const overLong = {
  ...draft,
  headlines: [...draft.headlines.slice(0, 2), 'This headline is definitely over thirty chars'],
  sitelinks: draft.sitelinks.map((link) => ({ ...link, verified: true })),
};
const gate = reviewDraftGate(overLong);
assert.ok(gate.lengthWarnings.some((msg) => /标题/.test(msg)), '超长标题应进 lengthWarnings');
assert.ok(!gate.hardErrors.some((msg) => /标题 \d+ 需在/.test(msg)), '超长标题不应进 hardErrors');

console.log('ads-automation.util.test.ts: ok');
