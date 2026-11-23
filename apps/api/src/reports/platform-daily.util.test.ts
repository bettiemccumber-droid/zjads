import assert from 'assert';
import { aggregatePlatformDaily, listDatesInRange } from './platform-daily.util';

assert.deepStrictEqual(listDatesInRange('2026-11-20', '2026-11-22'), [
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
]);

const { days, totals } = aggregatePlatformDaily(
  [
    {
      clickDate: new Date('2026-11-21T00:00:00.000Z'),
      clicks: 100,
      performanceOrders: 2,
      performanceCommission: 10.5,
    },
    {
      clickDate: '2026-11-21',
      clicks: 50,
      performanceOrders: 1,
      performanceCommission: '5.25',
    },
    {
      clickDate: new Date('2026-11-22T00:00:00.000Z'),
      clicks: 20,
      performanceOrders: 0,
      performanceCommission: 0,
    },
  ],
  '2026-11-20',
  '2026-11-22',
);

assert.strictEqual(days.length, 3);
assert.deepStrictEqual(days.map((d) => d.date), ['2026-11-22', '2026-11-21', '2026-11-20']);
assert.deepStrictEqual(days[0], { date: '2026-11-22', clicks: 20, orders: 0, commission: 0 });
assert.deepStrictEqual(days[1], { date: '2026-11-21', clicks: 150, orders: 3, commission: 15.75 });
assert.deepStrictEqual(days[2], { date: '2026-11-20', clicks: 0, orders: 0, commission: 0 });
assert.deepStrictEqual(totals, { clicks: 170, orders: 3, commission: 15.75 });

console.log('platform-daily.util.test.ts: ok');
