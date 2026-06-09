import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const ads = await prisma.adCampaignDaily.findMany({
    where: {
      campaignName: { contains: '148-lb2-Shutterfly' },
      date: { gte: new Date('2026-06-01'), lte: new Date('2026-06-07') },
    },
    orderBy: { date: 'asc' },
    select: { date: true, customerId: true, cost: true, clicks: true },
  });
  console.log('ad rows:');
  for (const r of ads) {
    console.log(r.date.toISOString().slice(0, 10), r.customerId, Number(r.cost), r.clicks);
  }

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      merchantId: '389263',
      orderDate: { gte: new Date('2026-06-01'), lte: new Date('2026-06-07') },
    },
    select: { orderDate: true, commission: true, channelAccountId: true },
    orderBy: { orderDate: 'asc' },
  });
  console.log('orders by day:');
  const byDay = new Map<string, { count: number; commission: number }>();
  for (const o of orders) {
    const d = o.orderDate.toISOString().slice(0, 10);
    const cur = byDay.get(d) ?? { count: 0, commission: 0 };
    cur.count += 1;
    cur.commission += Number(o.commission);
    byDay.set(d, cur);
  }
  for (const [d, v] of [...byDay.entries()].sort()) {
    console.log(d, 'orders', v.count, 'commission', v.commission.toFixed(2));
  }

  const clicks = await prisma.affiliateMerchantClickDaily.findMany({
    where: {
      merchantId: '389263',
      clickDate: { gte: new Date('2026-06-01'), lte: new Date('2026-06-07') },
    },
    orderBy: { clickDate: 'asc' },
  });
  const accountAlias = new Map(
    (await prisma.channelAccount.findMany({ select: { id: true, affiliateAlias: true } })).map(
      (a) => [a.id, a.affiliateAlias],
    ),
  );
  console.log('lb2 clicks:');
  for (const c of clicks.filter((x) => accountAlias.get(x.channelAccountId) === 'lb2')) {
    console.log(c.clickDate.toISOString().slice(0, 10), c.clicks, c.source);
  }
}

main().finally(() => prisma.$disconnect());
