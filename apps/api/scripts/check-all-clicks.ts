import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const agg = await prisma.affiliateMerchantClickDaily.aggregate({
    _sum: { clicks: true },
    _count: true,
  });
  console.log('全库点击日表:', agg);

  const groups = await prisma.affiliateMerchantClickDaily.groupBy({
    by: ['channelAccountId'],
    _sum: { clicks: true },
  });
  for (const g of groups) {
    const a = await prisma.channelAccount.findUnique({
      where: { id: g.channelAccountId },
      include: { platform: true },
    });
    console.log(`  ${a?.platform.code} ${a?.displayName} (${a?.affiliateAlias}): ${g._sum.clicks}`);
  }
}

main().finally(() => prisma.$disconnect());
