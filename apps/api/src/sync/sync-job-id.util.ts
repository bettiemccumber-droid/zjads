import { BadRequestException } from '@nestjs/common';
import { SyncJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** 采集任务 ID 上限，达到后清空历史并从 1 重新编号 */
export const SYNC_JOB_ID_CEILING = 1000;

const ACTIVE_STATUSES: SyncJobStatus[] = [SyncJobStatus.pending, SyncJobStatus.running];

/**
 * 重置 MySQL sync_jobs 自增 ID
 */
export async function resetSyncJobAutoIncrement(
  prisma: PrismaService,
  nextValue = 1,
): Promise<void> {
  const safe = Math.max(1, Math.min(Math.floor(nextValue), SYNC_JOB_ID_CEILING));
  await prisma.$executeRawUnsafe(`ALTER TABLE sync_jobs AUTO_INCREMENT = ${safe}`);
}

/**
 * 创建新任务前：若 ID 已达上限则清空已完成历史并从 1 重新轮；进行中任务会阻塞新建
 */
export async function ensureSyncJobIdCapacity(prisma: PrismaService): Promise<void> {
  const [maxRow, activeCount] = await Promise.all([
    prisma.syncJob.aggregate({ _max: { id: true } }),
    prisma.syncJob.count({
      where: { status: { in: ACTIVE_STATUSES } },
    }),
  ]);

  const maxId = maxRow._max.id ?? 0;
  if (maxId < SYNC_JOB_ID_CEILING) return;

  if (activeCount > 0) {
    throw new BadRequestException(
      `采集任务编号已达 ${SYNC_JOB_ID_CEILING} 上限，请等待进行中的任务完成后再创建（完成后将从 #1 重新编号）`,
    );
  }

  await prisma.syncJob.deleteMany({});
  await resetSyncJobAutoIncrement(prisma, 1);
}

/**
 * 手动清理后同步自增指针（避免 ID 空洞无限增大）
 */
export async function alignSyncJobAutoIncrement(prisma: PrismaService): Promise<void> {
  const [maxRow, count] = await Promise.all([
    prisma.syncJob.aggregate({ _max: { id: true } }),
    prisma.syncJob.count(),
  ]);

  if (count === 0) {
    await resetSyncJobAutoIncrement(prisma, 1);
    return;
  }

  const maxId = maxRow._max.id ?? 0;
  const activeCount = await prisma.syncJob.count({
    where: { status: { in: ACTIVE_STATUSES } },
  });

  if (activeCount === 0 && maxId >= SYNC_JOB_ID_CEILING) {
    await prisma.syncJob.deleteMany({});
    await resetSyncJobAutoIncrement(prisma, 1);
    return;
  }

  const next = Math.min(maxId + 1, SYNC_JOB_ID_CEILING);
  await resetSyncJobAutoIncrement(prisma, next);
}
