import assert from 'assert';
import { buildCreateCampaignPayload } from './mutate-payload';
import {
  affiliateKeywordDensity,
  annotateAffiliateKeywords,
  buildCampaignName,
  buildSampleDraft,
  buildTrackUrl,
  isCustomerEligible,
  softenExcessiveUppercase,
  usdToMicros,
  validateDraft,
} from './ads-automation.util';

const draft = buildSampleDraft({
  merchantName: 'AG Jeans Outlet',
  merchantUrl: 'https://www.agjeansoutlet.com/',
  countryCode: 'US',
  languageCode: 'en',
});

assert.deepStrictEqual(validateDraft(draft), []);
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

const tooLong = { ...draft, headlines: ['x'.repeat(31), 'ab', 'cd'] };
assert.ok(validateDraft(tooLong).length > 0);

assert.strictEqual(softenExcessiveUppercase('SHOPNOW Today'), 'Shopnow Today');
assert.strictEqual(softenExcessiveUppercase('BEST DEALS'), 'BEST Deals');
assert.strictEqual(softenExcessiveUppercase('FREE'), 'FREE');
const allCaps = { ...draft, headlines: ['SHOPNOW Official', 'Shop Brand', 'Visit Store'] };
assert.ok(validateDraft(allCaps).some((msg) => /连续大写/.test(msg)));
assert.deepStrictEqual(
  validateDraft({ ...draft, headlines: ['FREE Shipping', 'Shop Brand', 'Visit Store'] }),
  [],
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

console.log('ads-automation.util.test.ts: ok');
