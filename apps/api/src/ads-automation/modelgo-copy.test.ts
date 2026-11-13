import assert from 'assert';
import { buildSampleDraft, geoTargetForCountry, languageConstant, validateDraft } from './ads-automation.util';
import { applyAdCopy, audienceLanguage, parseModelJson } from './modelgo-copy';

assert.strictEqual(audienceLanguage('MX', 'es'), 'Spanish as used in Mexico');
assert.strictEqual(audienceLanguage('ES', 'es'), 'Spanish as used in Spain');
assert.strictEqual(audienceLanguage('VN', 'vi'), 'Vietnamese');
assert.strictEqual(geoTargetForCountry('VN'), '2704');
assert.strictEqual(geoTargetForCountry('MX'), '2484');
assert.strictEqual(geoTargetForCountry('ES'), '2724');
assert.strictEqual(languageConstant('vi'), '1040');

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
assert.strictEqual(draft.headlines.length, 3);
assert.strictEqual(draft.merchantUrl, 'https://example.com/');
assert.strictEqual(draft.dailyBudgetUsd, '3.00');
