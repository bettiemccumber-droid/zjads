/** 联盟采集任务摘要（管理员排查用） */
export interface AffiliateCollectionSnapshot {
  jobId: number | null;
  status: string | null;
  dateRange: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progress: string | null;
  errorMessage: string | null;
}

/** Sheet 导入摘要 */
export interface SheetCollectionSnapshot {
  sourceName: string | null;
  importedAt: string | null;
  sheetNames: string[];
  sheetCount: number;
  nameSummary: string | null;
}

export type SheetSourcePick = {
  name: string;
  updatedAt: Date;
};

/**
 * 将员工多个 Sheet 数据源转为管理员可读摘要
 */
export function buildSheetSnapshot(sources: SheetSourcePick[]): SheetCollectionSnapshot {
  if (!sources.length) {
    return {
      sourceName: null,
      importedAt: null,
      sheetNames: [],
      sheetCount: 0,
      nameSummary: null,
    };
  }

  const sorted = [...sources].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const sheetNames = sorted.map((s) => s.name);
  const importedAt = sorted[0].updatedAt.toISOString();
  const sourceName = sorted[0].name;
  const nameSummary =
    sources.length > 1 ? `${sources.length} 个：${sheetNames.join('、')}` : sourceName;

  return {
    sourceName,
    importedAt,
    sheetNames,
    sheetCount: sources.length,
    nameSummary,
  };
}

export type SyncJobPick = {
  id: number;
  ownerUserId: number;
  status: string;
  startDate: Date;
  endDate: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  totalItems: number;
  completed: number;
  failed: number;
  errorMessage: string | null;
};

/**
 * 将 SyncJob 转为管理员可读摘要
 */
export function buildAffiliateSnapshot(job: SyncJobPick | null | undefined): AffiliateCollectionSnapshot {
  if (!job) {
    return {
      jobId: null,
      status: null,
      dateRange: null,
      startedAt: null,
      finishedAt: null,
      progress: null,
      errorMessage: null,
    };
  }

  const dateRange = `${formatDateOnly(job.startDate)} ~ ${formatDateOnly(job.endDate)}`;
  let progress: string | null = null;
  if (job.totalItems > 0) {
    progress = `${job.completed}/${job.totalItems} 账号成功`;
    if (job.failed > 0) progress += `，${job.failed} 失败`;
  }

  return {
    jobId: job.id,
    status: job.status,
    dateRange,
    startedAt: (job.startedAt ?? job.createdAt).toISOString(),
    finishedAt: job.completedAt?.toISOString() ?? null,
    progress,
    errorMessage: job.errorMessage,
  };
}

/**
 * 取每个用户最新一条 SyncJob
 */
export function pickLatestJobByUser(jobs: SyncJobPick[]): Map<number, SyncJobPick> {
  const map = new Map<number, SyncJobPick>();
  for (const job of jobs) {
    if (!map.has(job.ownerUserId)) map.set(job.ownerUserId, job);
  }
  return map;
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
