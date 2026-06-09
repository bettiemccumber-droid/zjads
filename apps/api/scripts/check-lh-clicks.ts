import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.channelAccount.findMany({
    select: {
      id: true,
      displayName: true,
      affiliateAlias: true,
      platform: { select: { code: true, name: true } },
    },
  });
  console.log('=== 渠道账号 ===');
  for (const a of accounts) {
    console.log(`  #${a.id} ${a.platform.code} ${a.displayName} alias=${a.affiliateAlias}`);
  }

  const start = '2026-05-27';
  const end = '2026-06-02';
  const dateFilter = { gte: new Date(start), lte: new Date(end) };

  for (const code of ['linkhaitao', 'partnermatic']) {
    const sum = await prisma.affiliateMerchantClickDaily.aggregate({
      _sum: { clicks: true },
      where: { channelAccount: { platform: { code } }, clickDate: dateFilter },
    });
    const groups = await prisma.affiliateMerchantClickDaily.groupBy({
      by: ['merchantId'],
      _sum: { clicks: true },
      where: { channelAccount: { platform: { code } }, clickDate: dateFilter },
      orderBy: { _sum: { clicks: 'desc' } },
    });
    console.log(`\n=== ${code} 点击 ${start}~${end} ===`);
    console.log(`  总计: ${sum._sum.clicks ?? 0}, 商家数: ${groups.length}`);
    for (const g of groups.slice(0, 8)) {
      console.log(`    mid=${g.merchantId} clicks=${g._sum.clicks}`);
    }
  }

  const campaigns = await prisma.adCampaignDaily.findMany({
    where: { date: dateFilter, campaignName: { contains: 'lh2' } },
    distinct: ['campaignId'],
    select: { campaignName: true, merchantId: true, affiliateAlias: true },
    take: 5,
  });
  const orders = await prisma.affiliateOrder.groupBy({
    by: ['merchantId'],
    _count: true,
    _sum: { commission: true },
    where: {
      channelAccount: { platform: { code: 'linkhaitao' } },
      orderDate: dateFilter,
    },
    orderBy: { _count: { merchantId: 'desc' } },
  });
  console.log('\n=== LH 订单 merchantId TOP ===');
  for (const o of orders.slice(0, 10)) {
    console.log(`  mid=${o.merchantId} orders=${o._count} comm=${o._sum.commission}`);
  }

  const sample = await prisma.affiliateOrder.findMany({
    where: { channelAccount: { platform: { code: 'linkhaitao' } } },
    take: 3,
    select: { merchantId: true, merchantName: true, rawPayload: true },
  });
  console.log('\n=== LH 订单样本 raw ===');
  for (const s of sample) {
    const raw = s.rawPayload as Record<string, unknown>;
    console.log(
      `  stored=${s.merchantId} name=${s.merchantName} raw m_id=${raw?.m_id} mcid=${raw?.mcid}`,
    );
  }

  const clickSample = await prisma.affiliateMerchantClickDaily.findMany({
    where: { channelAccount: { platform: { code: 'linkhaitao' } } },
    take: 3,
    select: { merchantId: true, merchantName: true, clicks: true },
  });
  console.log('\n=== LH 点击样本 ===');
  for (const c of clickSample) {
    console.log(`  mid=${c.merchantId} name=${c.merchantName} clicks=${c.clicks}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
