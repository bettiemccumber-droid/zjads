import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.adCampaignDaily.findMany({
    where: {
      campaignName: { contains: 'Shutterfly' },
      date: { gte: new Date('2026-06-05'), lte: new Date('2026-06-07') },
    },
    select: {
      date: true,
      customerId: true,
      campaignId: true,
      campaignName: true,
      impressions: true,
      clicks: true,
      cost: true,
    },
    orderBy: [{ date: 'asc' }, { customerId: 'asc' }],
  });

  console.log('rows count', rows.length);
  for (const r of rows) {
    console.log(
      r.date.toISOString().slice(0, 10),
      r.customerId,
      r.campaignId,
      'imp', r.impressions,
      'clk', r.clicks,
      'cost', Number(r.cost),
    );
  }

  const sources = await prisma.adDataSource.findMany({
    where: { ownerUserId: 2 },
    select: { id: true, name: true, sheetId: true, mainTab: true },
  });
  console.log('ad sources', sources);
}

main().finally(() => prisma.$disconnect());
