import assert from 'assert';
import { listDatesInRange, mergePlatformDaily } from './platform-daily.util';

assert.deepStrictEqual(listDatesInRange('2026-11-20', '2026-11-22'), [
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
]);

/** 有订单无广告 */
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
  });
  assert.deepStrictEqual(days.map((d) => d.date), ['2026-11-22', '2026-11-21', '2026-11-20']);
  assert.deepStrictEqual(days[0], {
    date: '2026-11-22',
    clicks: 0,
    orders: 1,
    cost: 0,
    commission: 3,
    rejected: 0,
    profit: 3,
  });
  assert.deepStrictEqual(days[1], {
    date: '2026-11-21',
    clicks: 0,
    orders: 2,
    cost: 0,
    commission: 17.5,
    rejected: 0,
    profit: 17.5,
  });
  assert.deepStrictEqual(days[2], {
    date: '2026-11-20',
    clicks: 0,
    orders: 0,
    cost: 0,
    commission: 0,
    rejected: 0,
    profit: 0,
  });
  assert.deepStrictEqual(totals, {
    clicks: 0,
    orders: 3,
    cost: 0,
    commission: 20.5,
    rejected: 0,
    profit: 20.5,
  });
}

/** 有广告无订单：同日多系列花费累加 */
{
  const { days, totals } = mergePlatformDaily({
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    adRows: [
      { date: '2026-11-21', clicks: 40, cost: 12.3 },
      { date: '2026-11-21', clicks: 10, cost: 7.7 },
    ],
  });
  assert.deepStrictEqual(days[0], {
    date: '2026-11-21',
    clicks: 50,
    orders: 0,
    cost: 20,
    commission: 0,
    rejected: 0,
    profit: -20,
  });
  assert.deepStrictEqual(totals, {
    clicks: 50,
    orders: 0,
    cost: 20,
    commission: 0,
    rejected: 0,
    profit: -20,
  });
}

/** 拒付 + 利润公式：commission - rejected - cost */
{
  const { days, totals } = mergePlatformDaily({
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    orderRows: [
      { orderDate: '2026-11-21', orderKey: '1|a', commission: 100, rejected: 15 },
      { orderDate: '2026-11-21', orderKey: '1|b', commission: 20, rejected: 5 },
    ],
    adRows: [{ date: '2026-11-21', clicks: 8, cost: 30 }],
  });
  assert.deepStrictEqual(days[0], {
    date: '2026-11-21',
    clicks: 8,
    orders: 2,
    cost: 30,
    commission: 120,
    rejected: 20,
    profit: 70,
  });
  assert.deepStrictEqual(totals, {
    clicks: 8,
    orders: 2,
    cost: 30,
    commission: 120,
    rejected: 20,
    profit: 70,
  });
}

/** RW：performance 口径；拒付仍来自 orderRows；点击来自广告 */
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
    orderRows: [
      { orderDate: '2026-11-21', orderKey: 'ignored', commission: 999, rejected: 2 },
    ],
    adRows: [{ date: '2026-11-21', clicks: 55, cost: 4 }],
  });
  assert.deepStrictEqual(days[0], {
    date: '2026-11-21',
    clicks: 55,
    orders: 3,
    cost: 4,
    commission: 14,
    rejected: 2,
    profit: 8,
  });
  assert.deepStrictEqual(totals, {
    clicks: 55,
    orders: 3,
    cost: 4,
    commission: 14,
    rejected: 2,
    profit: 8,
  });
}

console.log('platform-daily.util.test.ts: ok');
