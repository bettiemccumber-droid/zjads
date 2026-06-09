/** 一次性：标记卡住的采集任务为失败 */
import { PrismaClient, SyncJobItemStatus, SyncJobStatus } from '@prisma/client';

const STALE_MSG = '任务已中断（服务重启或超时），请重新点击「开始采集」';

async function main() {
  const prisma = new PrismaClient();
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const stale = await prisma.syncJob.findMany({
    where: {
      status: { in: [SyncJobStatus.pending, SyncJobStatus.running] },
      OR: [{ startedAt: { lt: cutoff } }, { startedAt: null, createdAt: { lt: cutoff } }],
    },
  });
  console.log(`找到 ${stale.length} 个卡住的任务:`, stale.map((j) => j.id));
  for (const job of stale) {
    await prisma.syncJobItem.updateMany({
      where: {
        syncJobId: job.id,
        status: { in: [SyncJobItemStatus.pending, SyncJobItemStatus.running] },
      },
      data: {
        status: SyncJobItemStatus.failed,
        errorMessage: STALE_MSG,
        completedAt: new Date(),
      },
    });
    await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: SyncJobStatus.failed,
        failed: job.totalItems,
        errorMessage: STALE_MSG,
        completedAt: new Date(),
      },
    });
  }
  await prisma.$disconnect();
}

main();
