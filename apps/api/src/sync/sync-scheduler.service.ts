import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { scheduledSyncDateRange } from './scheduled-sync.util';
import { SyncService } from './sync.service';

export interface ScheduledSyncRunResult {
  trigger: 'cron' | 'manual';
  startedAt: string;
  startDate: string;
  endDate: string;
  includeClicks: boolean;
  skippedUsers: number;
  startedJobs: number;
  failedUsers: number;
  results: Array<{
    userId: number;
    username: string;
    ok: boolean;
    jobId?: number;
    message?: string;
  }>;
}

/** 定时全员联盟订单采集（试点：默认关闭，由环境变量开启） */
@Injectable()
export class SyncSchedulerService implements OnModuleInit {
  private readonly log = new Logger(SyncSchedulerService.name);
  private lastRun: ScheduledSyncRunResult | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  onModuleInit() {
    const enabled = this.isEnabled();
    const cron = this.config.get<string>('SCHEDULED_SYNC_CRON') ?? '10 6 * * *';
    const tz = this.config.get<string>('SCHEDULED_SYNC_TIMEZONE') ?? 'Asia/Shanghai';
    this.log.log(
      enabled
        ? `定时采集已启用（cron=${cron}, tz=${tz}）`
        : '定时采集未启用：生产环境设 SCHEDULED_SYNC_ENABLED=true 后重启 API',
    );
  }

  getConfig() {
    const lookback = this.lookbackDays();
    const range = scheduledSyncDateRange(lookback);
    return {
      enabled: this.isEnabled(),
      cron: this.config.get<string>('SCHEDULED_SYNC_CRON') ?? '10 6 * * *',
      timeZone: this.config.get<string>('SCHEDULED_SYNC_TIMEZONE') ?? 'Asia/Shanghai',
      lookbackDays: lookback,
      includeClicks: this.includeClicks(),
      nextRangePreview: range,
      lastRun: this.lastRun,
    };
  }

  getLastRun() {
    return this.lastRun;
  }

  isEnabled(): boolean {
    return this.config.get<string>('SCHEDULED_SYNC_ENABLED') === 'true';
  }

  /** 每天 06:10（上海）尝试跑一轮；未启用时直接返回 */
  @Cron('10 6 * * *', { timeZone: 'Asia/Shanghai' })
  async onDailyCron() {
    if (!this.isEnabled()) return;
    await this.runScheduledSync('cron');
  }

  /** 管理员手动试跑（与定时任务相同逻辑） */
  async runScheduledSync(trigger: 'cron' | 'manual'): Promise<ScheduledSyncRunResult> {
    const lookback = this.lookbackDays();
    const { startDate, endDate } = scheduledSyncDateRange(lookback);
    const includeClicks = this.includeClicks();
    const startedAt = new Date().toISOString();

    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: UserRole.OPERATOR },
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });

    const results: ScheduledSyncRunResult['results'] = [];
    let skippedUsers = 0;
    let startedJobs = 0;
    let failedUsers = 0;

    for (const u of users) {
      const busy = await this.sync.hasActiveSyncJob(u.id);
      if (busy) {
        skippedUsers += 1;
        results.push({
          userId: u.id,
          username: u.username,
          ok: false,
          message: '该员工已有进行中的采集任务，已跳过',
        });
        continue;
      }

      try {
        const job = await this.sync.createJobForOwner(u.id, startDate, endDate, includeClicks);
        startedJobs += 1;
        results.push({ userId: u.id, username: u.username, ok: true, jobId: job.id });
      } catch (e) {
        failedUsers += 1;
        results.push({
          userId: u.id,
          username: u.username,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const summary: ScheduledSyncRunResult = {
      trigger,
      startedAt,
      startDate,
      endDate,
      includeClicks,
      skippedUsers,
      startedJobs,
      failedUsers,
      results,
    };

    this.lastRun = summary;
    this.log.log(
      `[${trigger}] 定时采集：${startDate}~${endDate}，启动 ${startedJobs} 个任务，跳过 ${skippedUsers}，失败 ${failedUsers}`,
    );

    return summary;
  }

  private lookbackDays(): number {
    const raw = parseInt(this.config.get<string>('SCHEDULED_SYNC_LOOKBACK_DAYS') ?? '30', 10);
    return Number.isFinite(raw) ? raw : 30;
  }

  private includeClicks(): boolean {
    return this.config.get<string>('SCHEDULED_SYNC_INCLUDE_CLICKS') === 'true';
  }
}
