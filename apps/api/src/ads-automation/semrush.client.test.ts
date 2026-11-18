import assert from 'assert';
import { domainFromUrl, parseSemrushCsv, semrushDatabase } from './semrush.client';

assert.strictEqual(semrushDatabase('US'), 'us');
assert.strictEqual(semrushDatabase('GB'), 'uk');
assert.strictEqual(semrushDatabase('xx'), 'us');
assert.strictEqual(domainFromUrl('https://www.Example.com/path'), 'example.com');

const csv = [
  'Keyword;Position;Search Volume;CPC;Traffic (%)',
  'running shoes;3;12000;1.25;4.5',
  'best sneakers;11;800;0.40;0.8',
].join('\n');
assert.deepStrictEqual(parseSemrushCsv(csv), [
  { keyword: 'running shoes', position: 3, searchVolume: 12000, cpc: 1.25, traffic: 4.5 },
  { keyword: 'best sneakers', position: 11, searchVolume: 800, cpc: 0.4, traffic: 0.8 },
]);

console.log('semrush.client.test ok');
