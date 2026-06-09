import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const customers = await prisma.adCampaignDaily.groupBy({
    by: ['customerId'],
    _count: true,
  });
  console.log('Sheet 已导入的 Google Ads 账户 ID:');
  for (const c of customers) console.log(`  ${c.customerId} (${c._count} 行)`);

  const lhCampaigns = await prisma.adCampaignDaily.findMany({
    where: { campaignName: { contains: 'lh2' } },
    distinct: ['customerId'],
    select: { customerId: true, campaignName: true },
    take: 3,
  });
  console.log('\nlh2 系列样本账户:', lhCampaigns.map((r) => r.customerId));

  const source = await prisma.adDataSource.findFirst({
    select: { name: true, sheetUrl: true },
  });
  console.log('\n当前数据源:', source?.name);
  console.log('Sheet URL:', source?.sheetUrl?.slice(0, 80));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
