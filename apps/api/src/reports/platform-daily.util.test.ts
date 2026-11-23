import assert from 'assert';
import { listDatesInRange, mergePlatformDaily } from './platform-daily.util';

assert.deepStrictEqual(listDatesInRange('2026-11-20', '2026-11-22'), [
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
]);

/** 有订单无点击 */
{
  const { days, totals } = mergePlatformDaily({
    startDate: '2026-11-20',
    endDate: '2026-11-22',
    orderRows: [
      { orderDate: '2026-11-21', orderKey: '1|oid-a', commission: 10 },
      { orderDate: '2026-11-21', orderKey: '1|oid-a', commission: 5.5 },
      { orderDate: '2026-11-21', orderKey: '1|oid-b', commission: 2 },
      { orderDate: new Date('2026-11-22T00:00:00.000Z'), orderKey: '1|oid-c', commission: 3 },
    ],
    clickRows: [],
  });
  assert.deepStrictEqual(days.map((d) => d.date), ['2026-11-22', '2026-11-21', '2026-11-20']);
  assert.deepStrictEqual(days[0], { date: '2026-11-22', clicks: 0, orders: 1, commission: 3 });
  assert.deepStrictEqual(days[1], { date: '2026-11-21', clicks: 0, orders: 2, commission: 17.5 });
  assert.deepStrictEqual(days[2], { date: '2026-11-20', clicks: 0, orders: 0, commission: 0 });
  assert.deepStrictEqual(totals, { clicks: 0, orders: 3, commission: 20.5 });
}

/** 有点击无订单 */
{
  const { days, totals } = mergePlatformDaily({
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    orderRows: [],
    clickRows: [
      { clickDate: '2026-11-21', clicks: 40 },
      { clickDate: '2026-11-21', clicks: 10 },
    ],
  });
  assert.deepStrictEqual(days[0], { date: '2026-11-21', clicks: 50, orders: 0, commission: 0 });
  assert.deepStrictEqual(totals, { clicks: 50, orders: 0, commission: 0 });
}

/** RW：performance 口径 */
{
  const { days, totals } = mergePlatformDaily({
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    usePerformanceMetrics: true,
    clickRows: [
      {
        clickDate: '2026-11-21',
        clicks: 100,
        performanceOrders: 2,
        performanceCommission: 12.34,
      },
      {
        clickDate: '2026-11-21',
        clicks: 20,
        performanceOrders: 1,
        performanceCommission: 1.66,
      },
    ],
    orderRows: [{ orderDate: '2026-11-21', orderKey: 'ignored', commission: 999 }],
  });
  assert.deepStrictEqual(days[0], { date: '2026-11-21', clicks: 120, orders: 3, commission: 14 });
  assert.deepStrictEqual(totals, { clicks: 120, orders: 3, commission: 14 });
}

console.log('platform-daily.util.test.ts: ok');
