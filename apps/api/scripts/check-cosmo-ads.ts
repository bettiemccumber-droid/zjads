import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';

const prisma = new PrismaClient();

async function main() {
  const mid = '146792';
  const start = '2026-05-27';
  const end = '2026-06-02';

  const lh = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { ownerUserId: true },
  });
  if (!lh) return;

  const byMidField = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      merchantId: mid,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    distinct: ['campaignName'],
    select: { campaignName: true, campaignStatus: true },
  });

  const byName = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      campaignName: { contains: mid },
      date: { gte: new Date(start), lte: new Date(end) },
    },
    distinct: ['campaignName'],
    select: { campaignName: true, campaignStatus: true },
  });

  const byCosmo = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      campaignName: { contains: 'COSMO' },
      date: { gte: new Date(start), lte: new Date(end) },
    },
    distinct: ['campaignName'],
    select: { campaignName: true, campaignStatus: true },
  });

  const allLh = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true },
  });

  const lhMids = new Set<string>();
  for (const ad of allLh) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (alias.startsWith('lh')) lhMids.add(ad.merchantId || parsed.merchantId);
  }

  console.log(`=== Google Ads 导入数据：商家 ${mid} (COSMO) ===`);
  console.log(`merchantId 字段匹配: ${byMidField.length}`, byMidField);
  console.log(`系列名含 ${mid}: ${byName.length}`, byName);
  console.log(`系列名含 cosmo: ${byCosmo.length}`, byCosmo);
  console.log(`\n当前 Sheet 已导入的 lh2 商家 ID 共 ${lhMids.size} 个:`);
  console.log([...lhMids].sort().join(', '));
  console.log(`\n${mid} 是否在 lh 系列中: ${lhMids.has(mid) ? '是' : '否'}`);

  const order = await prisma.affiliateOrder.aggregate({
    where: {
      merchantId: mid,
      orderDate: {
        gte: new Date(`${start}T00:00:00.000Z`),
        lte: new Date(`${end}T23:59:59.999Z`),
      },
    },
    _count: true,
    _sum: { commission: true },
  });
  console.log(`\nLH 联盟订单: ${order._count} 单, 佣金 $${Number(order._sum.commission).toFixed(2)}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
