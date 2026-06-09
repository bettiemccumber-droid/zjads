import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const patterns = ['146792', 'COSMO', '083-lh2'];

  for (const p of patterns) {
    const rows = await prisma.adCampaignDaily.findMany({
      where: { campaignName: { contains: p } },
      distinct: ['campaignName'],
      select: { campaignName: true, merchantId: true, affiliateAlias: true },
      take: 5,
    });
    console.log(`\n含 "${p}" 的系列: ${rows.length}`);
    for (const r of rows) console.log(' ', r.campaignName, '| mid=', r.merchantId);
  }

  const count = await prisma.adCampaignDaily.count({
    where: { campaignName: { contains: '146792' } },
  });
  console.log(`\n146792 日表总行数(全历史): ${count}`);

  const lh = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { ownerUserId: true },
  });
  const sources = await prisma.adDataSource.findMany({
    where: { ownerUserId: lh!.ownerUserId },
    select: { id: true, name: true, sheetUrl: true, updatedAt: true },
  });
  console.log('\n广告数据源:');
  for (const s of sources) console.log(`  #${s.id} ${s.name} updated=${s.updatedAt.toISOString()}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
