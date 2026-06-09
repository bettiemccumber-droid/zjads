import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
prisma.syncJob
  .findMany({ orderBy: { id: 'desc' }, take: 5, include: { items: true } })
  .then((jobs) => {
    for (const j of jobs) {
      console.log(
        `#${j.id} status=${j.status} started=${j.startedAt?.toISOString()} completed=${j.completedAt?.toISOString()}`,
      );
      for (const i of j.items) {
        console.log(`  item status=${i.status} msg=${i.errorMessage?.slice(0, 60)}`);
      }
    }
  })
  .finally(() => prisma.$disconnect());
