import assert from 'assert';
import { crawlMerchantImages, extractMerchantImages } from './merchant-page-images';

const html = `<!doctype html>
<html><head>
<meta property="og:image" content="https://cdn.example.com/hero.jpg">
<meta property="og:image:width" content="1200">
</head><body>
<img src="https://cdn.example.com/pixel.gif" width="1" height="1" alt="pixel">
<img src="/products/shoe.jpg" alt="Shoe">
<img src="https://cdn.example.com/sprite.svg" alt="icon">
<img src="https://www.facebook.com/tr?id=1" alt="track">
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

crawlMerchantImages('http://127.0.0.1/secret').then(() => {
  throw new Error('private address was crawled');
}, (error: Error) => {
  assert.strictEqual(error.message, '这个网址不能抓取');
  console.log('merchant-page-images.test.ts: ok');
});
