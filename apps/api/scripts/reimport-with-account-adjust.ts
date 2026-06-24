/**
 * 用账户 Sheet 补齐后重新导入指定区间广告费
 */
import { PrismaClient } from '@prisma/client';
import { AdSourcesService } from '../src/ad-sources/ad-sources.service';
import { PrismaService } from '../src/prisma/prisma.service';

const OWNER_USER_ID = 2;
const START = '2026-06-16';
const END = '2026-06-22';

async function main() {
  const prisma = new PrismaClient();
  const service = new AdSourcesService(new PrismaService());

  const source = await prisma.adDataSource.findFirst({
    where: { ownerUserId: OWNER_USER_ID, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!source) {
    console.log('no ad source for user', OWNER_USER_ID);
    return;
  }

  const before = await prisma.adCampaignDaily.aggregate({
    where: {
      ownerUserId: OWNER_USER_ID,
      date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
    },
    _sum: { cost: true },
  });
  console.log('DB before:', Number(before._sum.cost ?? 0).toFixed(2));

  const result = await service.importForOwner(OWNER_USER_ID, START, END);
  console.log('import result:', result);

  const after = await prisma.adCampaignDaily.aggregate({
    where: {
      ownerUserId: OWNER_USER_ID,
      date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
    },
    _sum: { cost: true },
  });
  console.log('DB after:', Number(after._sum.cost ?? 0).toFixed(2));

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
