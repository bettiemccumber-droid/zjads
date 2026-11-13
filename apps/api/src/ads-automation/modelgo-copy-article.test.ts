import assert from 'assert';
import { applyArticle } from './modelgo-copy';
import { pickArticleImages, renderAffiliateText, sampleArticleHtml } from './ads-automation.util';

const article = applyArticle({
  title: 'ClassPass UK review',
  intro: ['I tried [[affiliate:ClassPass]] for a month.', 'It helped when my schedule kept changing.'],
  sections: [
    { heading: 'What you get', paragraphs: ['One membership across studios.', 'Booking is app-based.'] },
    { heading: 'Who it suits', text: 'Travelers.\n\nPeople who get bored of one gym.' },
    { heading: 'Before you join', paragraphs: ['Check [[affiliate:ClassPass membership]] near you.'] },
  ],
});

assert.strictEqual(article.intro.length, 2);
assert.strictEqual(article.sections.length, 3);
assert.deepStrictEqual(article.sections[1].paragraphs, ['Travelers.', 'People who get bored of one gym.']);

const picked = pickArticleImages([
  'https://cdn.example.com/a.jpg',
  'https://cdn.example.com/b.jpg',
  'data:image/jpeg;base64,aaaa',
]);
assert.strictEqual(picked.cover, 'https://cdn.example.com/a.jpg');
assert.deepStrictEqual(picked.body, ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']);

const linked = renderAffiliateText('Try [[affiliate:ClassPass UK]] today http://evil.example', 'https://track.example/x');
assert.ok(linked.includes('href="https://track.example/x"'));
assert.ok(linked.includes('>ClassPass UK</a>'));
assert.ok(!linked.includes('evil.example'));

const html = sampleArticleHtml(article, 'ClassPass', 'https://track.example/x', picked.body);
assert.ok(html.includes('<figure>'));
assert.ok(html.includes('class="link--affiliate"'));
assert.ok((html.match(/link--affiliate/g) || []).length >= 2);
assert.ok(html.indexOf('<p>I tried') < html.indexOf('<figure>'));
assert.ok(html.indexOf('<figure>') < html.indexOf('<h2>What you get</h2>'));
assert.ok(!html.startsWith('<p><img'));
console.log('ok');
