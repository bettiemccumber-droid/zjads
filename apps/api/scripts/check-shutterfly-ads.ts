import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.adCampaignDaily.findMany({
    where: {
      campaignName: { contains: 'Shutterfly' },
    },
    orderBy: [{ date: 'asc' }, { customerId: 'asc' }],
    select: {
      ownerUserId: true,
      date: true,
      customerId: true,
      campaignStatus: true,
      cost: true,
      clicks: true,
      impressions: true,
    },
  });

  console.log('total rows', rows.length);
  for (const r of rows) {
    console.log(
      r.date.toISOString().slice(0, 10),
      'owner', r.ownerUserId,
      r.customerId,
      r.campaignStatus,
      Number(r.cost).toFixed(2),
      r.clicks,
    );
  }
}

main()
  .finally(() => prisma.$disconnect());
