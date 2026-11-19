import assert from 'assert';
import {
  crawlMerchantImages,
  extractMerchantImages,
  extractSocialProfileLinks,
  looksLikeScriptNoise,
  prioritizeDeepLinks,
} from './merchant-page-images';

const html = `<!doctype html>
<html><head>
<meta property="og:image" content="https://cdn.example.com/hero.jpg">
<meta property="og:image:width" content="1200">
</head><body>
<img src="https://cdn.example.com/pixel.gif" width="1" height="1" alt="pixel">
<img src="/products/shoe.jpg" alt="Shoe">
<img src="https://cdn.example.com/sprite.svg" alt="icon">
<img src="https://www.facebook.com/tr?id=1" alt="track">
<img src="\${(i=e==null?void 0:e.title)!=null?i:''}" alt="bad">
<img src=\\"https:\\/\\/cdn.example.com\\/pay\\/visa.png\\" alt=\\"Visa\\" />
<img src=\\"https:\\/\\/cdn.example.com\\/catalog\\/shoe.jpg\\" alt=\\"Shoe photo\\" />
<div style="background-image:url(//cdn.example.com/hero-wide.jpg)"></div>
</body></html>`;

const images = extractMerchantImages(html, 'https://shop.example.com/p/1');
assert.deepStrictEqual(images.map((item) => item.url), [
  'https://cdn.example.com/hero.jpg',
  'https://shop.example.com/products/shoe.jpg',
  'https://cdn.example.com/catalog/shoe.jpg',
  'https://cdn.example.com/hero-wide.jpg',
  'https://cdn.example.com/pay/visa.png',
]);
assert.strictEqual(images[1].alt, 'Shoe');
assert.ok(!images.some((item) => looksLikeScriptNoise(item.url) || looksLikeScriptNoise(item.alt)));
assert.ok(looksLikeScriptNoise('${(i=e==null?void 0:e.title)!=null?i:}'));

const socialHtml = `<a href="https://instagram.com/bluehost">IG</a>
<a href="https://www.facebook.com/bluehost">FB</a>
<a href="https://x.com/intent/tweet">skip</a>
<a href="https://www.linkedin.com/company/bluehost-com">LI</a>`;
const social = extractSocialProfileLinks(socialHtml, 'https://www.bluehost.com/');
assert.ok(social.some((item) => item.url.includes('instagram.com/bluehost')));
assert.ok(social.some((item) => item.url.includes('facebook.com/bluehost')));
assert.ok(social.some((item) => item.url.includes('linkedin.com/company/bluehost-com')));
assert.ok(!social.some((item) => item.url.includes('/intent/')));

const ranked = prioritizeDeepLinks([
  { url: 'https://shop.example.com/about', label: 'About' },
  { url: 'https://shop.example.com/collections/all', label: 'Shop' },
  { url: 'https://shop.example.com/products/shoe', label: 'Shoe' },
]);
assert.strictEqual(ranked[0].url, 'https://shop.example.com/collections/all');
assert.ok(ranked.some((item) => item.url.includes('/products/')));

crawlMerchantImages('http://127.0.0.1/secret').then(() => {
  throw new Error('private address was crawled');
}, (error: Error) => {
  assert.strictEqual(error.message, '这个网址不能抓取');
  console.log('merchant-page-images.test.ts: ok');
});
