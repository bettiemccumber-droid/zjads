import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const start = '2026-05-27';
  const end = '2026-06-02';
  const dateFilter = {
    gte: new Date(`${start}T00:00:00.000Z`),
    lte: new Date(`${end}T23:59:59.999Z`),
  };
  const clickDateFilter = { gte: new Date(start), lte: new Date(end) };

  const lhAccount = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { id: true, affiliateAlias: true },
  });
  if (!lhAccount) {
    console.log('no lh account');
    return;
  }

  const orderMerchants = await prisma.affiliateOrder.groupBy({
    by: ['merchantId'],
    _count: true,
    _sum: { commission: true },
    where: {
      channelAccountId: lhAccount.id,
      orderDate: dateFilter,
    },
    orderBy: { _count: { merchantId: 'desc' } },
  });

  const clickMerchants = await prisma.affiliateMerchantClickDaily.groupBy({
    by: ['merchantId'],
    _sum: { clicks: true },
    where: {
      channelAccountId: lhAccount.id,
      clickDate: clickDateFilter,
    },
    orderBy: { _sum: { clicks: 'desc' } },
  });

  const orderIds = new Set(
    orderMerchants.map((m) => m.merchantId).filter(Boolean) as string[],
  );
  const clickIds = new Set(clickMerchants.map((m) => m.merchantId));
  const clickOnly = [...clickIds].filter((id) => !orderIds.has(id));
  const orderOnly = [...orderIds].filter((id) => !clickIds.has(id));

  console.log(`LH 账号 alias=${lhAccount.affiliateAlias}`);
  console.log(`订单商家数: ${orderMerchants.length} (总订单 ${orderMerchants.reduce((s, m) => s + m._count, 0)})`);
  console.log(`点击商家数: ${clickMerchants.length} (总点击 ${clickMerchants.reduce((s, m) => s + (m._sum.clicks ?? 0), 0)})`);
  console.log(`仅有点击无订单: ${clickOnly.length}`, clickOnly.slice(0, 10));
  console.log(`仅有订单无点击: ${orderOnly.length}`, orderOnly.slice(0, 10));

  const nullMerchantOrders = await prisma.affiliateOrder.count({
    where: {
      channelAccountId: lhAccount.id,
      orderDate: dateFilter,
      OR: [{ merchantId: null }, { merchantId: '' }],
    },
  });
  console.log(`merchantId 为空订单: ${nullMerchantOrders}`);

  console.log('\n=== 订单商家列表 ===');
  for (const m of orderMerchants) {
    const clicks = clickMerchants.find((c) => c.merchantId === m.merchantId)?._sum.clicks ?? 0;
    console.log(`  ${m.merchantId} orders=${m._count} comm=${m._sum.commission} clicks=${clicks}`);
  }

  console.log('\n=== 仅点击商家 ===');
  for (const id of clickOnly) {
    const c = clickMerchants.find((x) => x.merchantId === id);
    console.log(`  ${id} clicks=${c?._sum.clicks}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
