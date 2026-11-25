import assert from 'assert';
import {
  assignUniqueSitelinkUrls,
  buildSampleDraft,
  geoTargetForCountry,
  languageConstant,
  normalizePageKey,
  sanitizeDraftForReview,
  sitelinkPageScore,
  validateDraft,
} from './ads-automation.util';
import {
  applyAdCopy,
  audienceLanguage,
  detectMerchantSeasonEvidence,
  nearbySeasonCopyHint,
  parseModelJson,
} from './modelgo-copy';
import { buildCreateCampaignPayload } from './mutate-payload';

const blackFridayUnknown = nearbySeasonCopyHint(new Date('2026-11-25T12:00:00Z'), 'US');
assert.ok(/Black Friday/i.test(blackFridayUnknown));
assert.ok(/Unconfirmed ≠ not participating/i.test(blackFridayUnknown));
assert.ok(/Do NOT name/i.test(blackFridayUnknown));
assert.ok(!/CONFIRMED MERCHANT SEASON/i.test(blackFridayUnknown));
assert.ok(!/has NO confirmed participation|merchant is not participating/i.test(blackFridayUnknown));

const blackFridayCrawlFailed = nearbySeasonCopyHint(new Date('2026-11-25T12:00:00Z'), 'US', {
  siteScan: 'failed',
});
assert.ok(/could not be crawled/i.test(blackFridayCrawlFailed));
assert.ok(/NOT proof the merchant is skipping/i.test(blackFridayCrawlFailed));
assert.ok(/Do NOT name/i.test(blackFridayCrawlFailed));

const blackFridayScannedNoHit = nearbySeasonCopyHint(new Date('2026-11-25T12:00:00Z'), 'US', {
  siteScan: 'ok',
  merchantEvidence: [],
});
assert.ok(/insufficient evidence/i.test(blackFridayScannedNoHit));
assert.ok(/NOT a conclusion that the merchant is not participating/i.test(blackFridayScannedNoHit));

const blackFridayConfirmed = nearbySeasonCopyHint(new Date('2026-11-25T12:00:00Z'), 'US', {
  merchantEvidence: ['Shop our Black Friday deals'],
  siteScan: 'ok',
});
assert.ok(/CONFIRMED MERCHANT SEASON/i.test(blackFridayConfirmed));
assert.ok(/MUST weave/i.test(blackFridayConfirmed));

const quietHint = nearbySeasonCopyHint(new Date('2026-04-10T12:00:00Z'), 'US');
assert.ok(!/CONFIRMED MERCHANT SEASON/i.test(quietHint));
assert.ok(/evergreen/i.test(quietHint));

assert.ok(detectMerchantSeasonEvidence(['Black Friday Sale', '/collections/bfcm']).some((item) => /Black Friday/i.test(item)));
assert.deepStrictEqual(detectMerchantSeasonEvidence(['Shop shoes online']), []);

assert.strictEqual(audienceLanguage('MX', 'es'), 'Spanish as used in Mexico');
assert.strictEqual(audienceLanguage('ES', 'es'), 'Spanish as used in Spain');
assert.strictEqual(audienceLanguage('VN', 'vi'), 'Vietnamese');
assert.strictEqual(audienceLanguage('PL', 'pl'), 'Polish');
assert.strictEqual(audienceLanguage('PL', ''), 'Polish');
assert.strictEqual(audienceLanguage('BR', 'pt'), 'Portuguese as used in Brazil');
assert.strictEqual(geoTargetForCountry('VN'), '2704');
assert.strictEqual(geoTargetForCountry('MX'), '2484');
assert.strictEqual(geoTargetForCountry('ES'), '2724');
assert.strictEqual(geoTargetForCountry('BR'), '2076');
assert.strictEqual(geoTargetForCountry('IT'), '2380');
assert.strictEqual(geoTargetForCountry('NG'), '2566');
assert.strictEqual(geoTargetForCountry('PL'), '2616');
assert.strictEqual(geoTargetForCountry('KR'), '2410');
assert.strictEqual(languageConstant('vi'), '1040');
assert.strictEqual(languageConstant('pt'), '1014');
assert.strictEqual(languageConstant('zh'), '1017');
assert.strictEqual(languageConstant('zh-CN'), '1017');
assert.strictEqual(languageConstant('zh_TW'), '1018');
assert.strictEqual(languageConstant('he'), '1027');
assert.strictEqual(languageConstant('fil'), '1042');

const withVerifiedSitelinks = <T extends { sitelinks: Array<{ verified: boolean }> }>(draft: T): T => ({
  ...draft,
  sitelinks: draft.sitelinks.map((link) => ({ ...link, verified: true })),
});

const base = buildSampleDraft({
  merchantName: 'Acegolfs',
  merchantUrl: 'https://example.com/',
  countryCode: 'VN',
  languageCode: 'vi',
});
const draft = applyAdCopy(
  base,
  parseModelJson(`\`\`\`json
{"headlines":["Gậy golf Acegolfs","Xem Acegolfs","Acegolfs hôm nay","${'x'.repeat(40)}"],"descriptions":["Xem gậy và phụ kiện Acegolfs.","Các mẫu đang bán tại Acegolfs."],"keywords":["acegolfs"],"sitelinks":[{"linkText":"Xem ngay","description1":"Gậy golf","description2":"Phụ kiện","finalUrl":"https://example.com/"},{"linkText":"Mua ngay","description1":"Phu kien","description2":"Gậy mới","finalUrl":"https://example.com/shop"},{"linkText":"Bo suu tap","description1":"Xem them","description2":"Lua chon","finalUrl":"https://example.com/collections"},{"linkText":"Ban chay","description1":"Top picks","description2":"Hot items","finalUrl":"https://example.com/best"},{"linkText":"Uu dai","description1":"Sale now","description2":"Save more","finalUrl":"https://example.com/sale"},{"linkText":"Lien he","description1":"Support","description2":"Help desk","finalUrl":"https://example.com/help"}],"callouts":["Chinh hang","Giao nhanh","Bao hanh","Mua online","Lua chon nhieu","Thanh toan an toan","Hang moi","Dat hang"]}
\`\`\``),
  [],
  { padFromTemplate: false },
);
assert.ok(draft.sitelinks.every((link) => !link.verified), '生成后站内链接默认未验证');
assert.ok(draft.headlines.some((text) => text.length > 30), '超长标题应保留原文，不硬截断');
assert.ok(
  validateDraft(withVerifiedSitelinks(draft)).some((msg) => /标题/.test(msg)),
  '超长标题应由 validateDraft 拦住，而不是静默截断',
);
assert.ok(draft.headlines.length >= 3);
assert.ok(!draft.headlines.some((text) => /^Explore /i.test(text)), 'AI 路径不应拼入 Explore 模板句');
assert.strictEqual(draft.merchantUrl, 'https://example.com/');
assert.strictEqual(draft.dailyBudgetUsd, '3.00');
assert.strictEqual(draft.sitelinks.length, 6);
assert.ok(draft.sitelinks.every((link) => link.linkText && link.description1 && link.description2 && link.finalUrl));
const sitelinkKeys = new Set(draft.sitelinks.map((link) => normalizePageKey(link.finalUrl)));
assert.strictEqual(sitelinkKeys.size, draft.sitelinks.length);
assert.ok(sitelinkKeys.has(normalizePageKey(draft.merchantUrl)), '有商家网址时优先放一条官网');
assert.strictEqual(normalizePageKey(draft.sitelinks[0].finalUrl), normalizePageKey(draft.merchantUrl));

const longDesc = `Discover travel deals and experiences with Klook across Australia including tours activities and attractions you can book today with flexible options for every traveler.`;
assert.ok(longDesc.length > 90);
const longZh = '探索澳大利亚各地可预订的旅游体验与景点，含行程、门票与灵活选项。';
const repaired = applyAdCopy(
  base,
  {
    headlines: ['Klook AU', 'Book Klook', 'Klook Trips', 'Black Friday Deals Today Extra'],
    descriptions: [longDesc, 'Book tours and tickets with Klook today.'],
    keywords: ['klook'],
    callouts: ['Official Site', 'Shop Online'],
    structuredSnippets: [
      { header: 'TYPES', values: ['Tours', 'Tickets', 'Activities', 'Transfers'] },
      { header: 'Styles', values: ['Family', 'Adventure', 'City', 'Day trips'] },
    ],
    translations: {
      headlines: ['Klook 澳洲', '预订 Klook', 'Klook 行程', '黑色星期五优惠今日加码'],
      descriptions: [longZh, '立即用 Klook 预订行程与门票。'],
    },
  },
  [],
  { padFromTemplate: false },
);
assert.strictEqual(repaired.descriptions[0], longDesc, '超长描述不硬截断，保留与译文同义的原文');
assert.strictEqual(repaired.translations?.descriptions?.[0], longZh);
assert.ok(repaired.headlines[3].includes('Black Friday'), '超长标题保留完整短语');
assert.strictEqual(repaired.translations?.headlines?.[3], '黑色星期五优惠今日加码');
assert.ok(validateDraft(withVerifiedSitelinks(repaired)).some((msg) => /描述|标题/.test(msg)));
assert.ok(repaired.descriptions.length >= 2);
assert.ok(repaired.headlines.length >= 3);
assert.ok(repaired.callouts.length >= 1);
assert.ok(!repaired.headlines.some((text) => /New Arrivals/i.test(text)));
assert.strictEqual(repaired.structuredSnippets.length, 2);
assert.strictEqual(repaired.structuredSnippets[0].header, 'Types');

const withinLimits = applyAdCopy(
  base,
  {
    headlines: ['Klook AU', 'Book Klook', 'Klook Trips'],
    descriptions: ['Book tours and tickets with Klook today.', 'Explore top activities on Klook AU.'],
    keywords: ['klook'],
    callouts: ['Official Site', 'Shop Online'],
    sitelinks: draft.sitelinks,
    structuredSnippets: [
      { header: 'Types', values: ['Tours', 'Tickets', 'Activities'] },
      { header: 'Styles', values: ['Family', 'Adventure', 'City'] },
    ],
  },
  [],
  { padFromTemplate: false },
);
assert.deepStrictEqual(validateDraft(withVerifiedSitelinks(withinLimits)), []);

const noPadSanitize = sanitizeDraftForReview(
  {
    ...base,
    headlines: ['Brand One', 'Brand Two', 'Brand Three'],
    descriptions: ['Desc one for the brand store.', 'Desc two with clear shipping info.'],
    callouts: ['Trusted Brand'],
    sitelinks: base.sitelinks.slice(0, 2),
    translations: undefined,
  },
  base,
  { padFromFallback: false },
);
assert.strictEqual(noPadSanitize.headlines.length, 3);
assert.ok(!noPadSanitize.headlines.some((text) => /Explore |New Arrivals|Picks/i.test(text)));
assert.ok((noPadSanitize.translations?.headlines?.length ?? 0) === 0);

const dirty = {
  ...base,
  callouts: ['Official Site', 'Save $20 Today', 'Free Shipping', 'Shop Online'],
  headlines: ['Buy now 50% off', 'Panini Store', 'Magazines'],
  promotion: 'Use code $X',
  cpcBidCeilingUsd: '',
  sitelinks: base.sitelinks.map((link, index) => (
    index === 1
      ? {
          ...link,
          linkText: 'Acegolfs Deals',
          description1: 'Save on gear',
          description2: 'Season sale live',
          verified: false,
        }
      : link
  )),
};
const cleaned = sanitizeDraftForReview(dirty, base);
// 宣传信息允许折扣 / 免运费；促销备注里的占位符 $X 仍会清掉
assert.ok(cleaned.callouts.some((text) => /\$|free shipping/i.test(text)));
assert.ok(cleaned.headlines.some((text) => /50%\s*off/i.test(text)));
assert.strictEqual(cleaned.promotion, '');
// 站内链接促销语应保留，不要被换回 Shop now 万能句
assert.ok(cleaned.sitelinks.some((link) => /Acegolfs Deals/i.test(link.linkText)));
assert.ok(cleaned.sitelinks.some((link) => /Season sale/i.test(link.description2)));
// 生成后的站内链接需人工标记已验证后才能过校验
assert.ok(cleaned.sitelinks.every((link) => link.finalUrl && !link.verified));
assert.deepStrictEqual(
  validateDraft({
    ...cleaned,
    sitelinks: cleaned.sitelinks.map((link) => ({ ...link, verified: true })),
  }),
  [],
);
assert.ok(cleaned.sitelinks.length >= 6);

const payload = buildCreateCampaignPayload({
  customerId: '130-512-5178',
  campaignName: 'test-campaign',
  draft: cleaned,
});
const campaignOp = (payload.mutateOperations as Array<Record<string, any>>)
  .find((item) => item.campaignOperation);
assert.deepStrictEqual(campaignOp?.campaignOperation.create.targetSpend, {});

assert.ok(sitelinkPageScore('https://x.com/shop', 'shop') > sitelinkPageScore('https://x.com/contact-us', 'Contact Us'));
const purchaseFirst = assignUniqueSitelinkUrls(
  [
    { linkText: 'Official website', description1: 'a', description2: 'b', finalUrl: '', verified: false },
    { linkText: 'Contact Us', description1: 'a', description2: 'b', finalUrl: 'https://example.com/pages/contact-us', verified: false },
    { linkText: 'Shop now', description1: 'a', description2: 'b', finalUrl: '', verified: false },
  ],
  'https://example.com/',
  [
    { url: 'https://example.com/pages/contact-us', label: 'Contact Us' },
    { url: 'https://example.com/collections/all', label: 'Shop' },
    { url: 'https://example.com/products/bag', label: 'Bag' },
  ],
);
assert.strictEqual(normalizePageKey(purchaseFirst[0].finalUrl), normalizePageKey('https://example.com/'));
assert.ok(!/contact/i.test(purchaseFirst[1].finalUrl));
assert.ok(/collections|products|shop/i.test(purchaseFirst[1].finalUrl));
