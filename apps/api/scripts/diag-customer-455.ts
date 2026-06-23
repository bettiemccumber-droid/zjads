import { PrismaClient } from '@prisma/client';

const START = '2026-06-16';
const END = '2026-06-22';
const CUSTOMER = '455-151-0460';

async function main() {
  const prisma = new PrismaClient();
  const rows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: 2,
      customerId: { contains: '455151' },
      date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
    },
    orderBy: { date: 'asc' },
  });
  console.log('DB rows for customer 455-151-0460:', rows.length);
  for (const r of rows) {
    console.log(
      r.date.toISOString().slice(0, 10),
      Number(r.cost).toFixed(2),
      r.campaignName,
    );
  }
  await prisma.$disconnect();
}

main().catch(console.error);
