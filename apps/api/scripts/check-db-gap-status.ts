import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const c91322 = await prisma.adCampaignDaily.count({
    where: { OR: [{ merchantId: '91322' }, { campaignName: { contains: '91322' } }] },
  });
  const c146792 = await prisma.adCampaignDaily.count({
    where: { OR: [{ merchantId: '146792' }, { campaignName: { contains: '146792' } }] },
  });
  const pausedLh = await prisma.adCampaignDaily.findMany({
    where: { campaignName: { contains: 'lh2' }, campaignStatus: 'PAUSED' },
    select: { campaignName: true },
    distinct: ['campaignName'],
  });
  console.log('DB 91322 rows:', c91322);
  console.log('DB 146792 rows:', c146792);
  console.log('DB paused lh2 distinct campaigns:', pausedLh.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
