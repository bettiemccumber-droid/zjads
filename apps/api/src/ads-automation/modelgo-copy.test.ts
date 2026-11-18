import assert from 'assert';
import {
  buildSampleDraft,
  geoTargetForCountry,
  languageConstant,
  normalizePageKey,
  sanitizeDraftForReview,
  validateDraft,
} from './ads-automation.util';
import { applyAdCopy, audienceLanguage, parseModelJson } from './modelgo-copy';
import { buildCreateCampaignPayload } from './mutate-payload';

assert.strictEqual(audienceLanguage('MX', 'es'), 'Spanish as used in Mexico');
assert.strictEqual(audienceLanguage('ES', 'es'), 'Spanish as used in Spain');
assert.strictEqual(audienceLanguage('VN', 'vi'), 'Vietnamese');
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

const base = buildSampleDraft({
  merchantName: 'Acegolfs',
  merchantUrl: 'https://example.com/',
  countryCode: 'VN',
  languageCode: 'vi',
});
const draft = applyAdCopy(
  base,
  parseModelJson(`\`\`\`json
{"headlines":["Gậy golf Acegolfs","Xem Acegolfs","Acegolfs hôm nay","${'x'.repeat(40)}"],"descriptions":["Xem gậy và phụ kiện Acegolfs.","Các mẫu đang bán tại Acegolfs."],"keywords":["acegolfs"],"sitelinks":[{"linkText":"Xem ngay","description1":"Gậy golf","description2":"Phụ kiện"}]}
\`\`\``),
);
assert.deepStrictEqual(validateDraft(draft), []);
assert.ok(draft.headlines.length >= 3);
assert.strictEqual(draft.merchantUrl, 'https://example.com/');
assert.strictEqual(draft.dailyBudgetUsd, '3.00');
const sitelinkKeys = new Set(draft.sitelinks.map((link) => normalizePageKey(link.finalUrl)));
assert.strictEqual(sitelinkKeys.size, draft.sitelinks.length);
assert.ok(!sitelinkKeys.has(normalizePageKey(draft.merchantUrl)));

const longDesc = `Discover travel deals and experiences with Klook across Australia including tours activities and attractions you can book today with flexible options.`;
assert.ok(longDesc.length > 70);
const repaired = applyAdCopy(base, {
  headlines: ['Klook AU', 'Book Klook', 'Klook Trips', 'x'.repeat(40)],
  descriptions: [longDesc],
  keywords: ['klook'],
  callouts: ['Official Site', 'Shop Online'],
  structuredSnippets: [{ header: 'TYPES', values: ['Tours', 'Tickets', 'Activities', 'Transfers'] }],
});
assert.deepStrictEqual(validateDraft(repaired), []);
assert.ok(repaired.descriptions.every((text) => text.length <= 70));
assert.ok(repaired.descriptions.length >= 2);
assert.ok(repaired.headlines.length >= 3);
assert.ok(repaired.callouts.length >= 1);
assert.strictEqual(repaired.structuredSnippets.length, 2);
assert.strictEqual(repaired.structuredSnippets[0].header, 'Types');

const dirty = {
  ...base,
  callouts: ['Official Site', 'Save $20 Today', 'Free Shipping', 'Shop Online'],
  headlines: ['Buy now 50% off', 'Panini Store', 'Magazines'],
  promotion: 'Use code $X',
  cpcBidCeilingUsd: '',
};
const cleaned = sanitizeDraftForReview(dirty, base);
assert.ok(!cleaned.callouts.some((text) => /\$|%|free shipping/i.test(text)));
assert.ok(cleaned.headlines.some((text) => /50%\s*off/i.test(text)));
assert.strictEqual(cleaned.promotion, '');
assert.deepStrictEqual(validateDraft(cleaned), []);
assert.ok(cleaned.sitelinks.length >= 6);

const payload = buildCreateCampaignPayload({
  customerId: '130-512-5178',
  campaignName: 'test-campaign',
  draft: cleaned,
});
const campaignOp = (payload.mutateOperations as Array<Record<string, any>>)
  .find((item) => item.campaignOperation);
assert.deepStrictEqual(campaignOp?.campaignOperation.create.targetSpend, {});
