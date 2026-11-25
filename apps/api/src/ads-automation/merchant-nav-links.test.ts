import assert from 'assert';
import { assignUniqueSitelinkUrls, normalizePageKey } from './ads-automation.util';
import { extractMerchantNavLinks } from './merchant-page-images';

const html = `
<html><body>
  <a href="/get-a-quote">Get a Quote</a>
  <a href="https://www.1800gotjunk.com/what-we-take">What We Take</a>
  <a href="/how-it-works">How It Works</a>
  <a href="https://other.com/x">External</a>
  <a href="/">Home</a>
  <a href="#top">Skip</a>
</body></html>
`;

const links = extractMerchantNavLinks(html, 'http://www.1800gotjunk.com/');
assert.strictEqual(links.length, 3);
assert.ok(links.some((item) => item.url.includes('/get-a-quote')));
assert.ok(links.every((item) => !normalizePageKey(item.url).endsWith('1800gotjunk.com/')));

const sitelinks = assignUniqueSitelinkUrls(
  [
    { linkText: 'Get a Quote', description1: 'a', description2: 'b', finalUrl: '', verified: false },
    { linkText: 'What We Take', description1: 'a', description2: 'b', finalUrl: '', verified: false },
    { linkText: 'How It Works', description1: 'a', description2: 'b', finalUrl: '', verified: false },
  ],
  'http://www.1800gotjunk.com/',
  links,
);

assert.strictEqual(new Set(sitelinks.map((item) => normalizePageKey(item.finalUrl))).size, 3);
assert.strictEqual(normalizePageKey(sitelinks[0].finalUrl), normalizePageKey('http://www.1800gotjunk.com/'));
assert.ok(sitelinks.some((item) => item.finalUrl.includes('get-a-quote')));
assert.ok(sitelinks.some((item) => item.finalUrl.includes('what-we-take') || item.finalUrl.includes('how-it-works')));
assert.ok(sitelinks.every((item) => item.finalUrl && !item.verified));

// 真实页不够时少生成，禁止 invent 假路径
const scarce = assignUniqueSitelinkUrls(
  [
    { linkText: 'Home', description1: 'a', description2: 'b', finalUrl: '', verified: false },
    { linkText: 'Quote', description1: 'a', description2: 'b', finalUrl: '', verified: false },
    { linkText: 'Extra 1', description1: 'a', description2: 'b', finalUrl: 'https://www.1800gotjunk.com/made-up-path', verified: false },
    { linkText: 'Extra 2', description1: 'a', description2: 'b', finalUrl: '', verified: false },
  ],
  'http://www.1800gotjunk.com/',
  [{ url: 'http://www.1800gotjunk.com/get-a-quote', label: 'Get a Quote' }],
);
assert.strictEqual(scarce.length, 2);
assert.strictEqual(normalizePageKey(scarce[0].finalUrl), normalizePageKey('http://www.1800gotjunk.com/'));
assert.ok(scarce[1].finalUrl.includes('get-a-quote'));
assert.ok(scarce.every((item) => !/made-up-path/i.test(item.finalUrl)));

console.log('merchant-nav-links.test ok');
