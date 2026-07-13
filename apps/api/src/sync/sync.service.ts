import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { SyncJobItemStatus, SyncJobStatus, UserRole } from '@prisma/client';
import { ChannelAccountsService } from '../channel-accounts/channel-accounts.service';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { isCollectorImplemented } from '../collectors/collectors.registry';
import { CollectorsService } from '../collectors/collectors.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdSourcesService } from '../ad-sources/ad-sources.service';
import { AlertsService } from '../alerts/alerts.service';

/** 超过此时长仍为 running 视为卡住（服务重启或点击采集异常） */
const STALE_JOB_MS = 3 * 60 * 60 * 1000;

const STALE_MSG = '任务已中断（服务重启或超时），请重新点击「开始采集」';

@Injectable()
export class SyncService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly channelAccounts: ChannelAccountsService,
    private readonly collectors: CollectorsService,
    private readonly alerts: AlertsService,
    private readonly adSources: AdSourcesService,
  ) {}

  async onModuleInit() {
    const n = await this.recoverStaleJobs();
    if (n > 0) {
      console.log(`[sync] 启动时已标记 ${n} 个卡住的任务为失败`);
    }
  }

  /**
   * 将超时未完成的采集任务标记为失败
   */
  async recoverStaleJobs(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_JOB_MS);
    const stale = await this.prisma.syncJob.findMany({
      where: {
        status: { in: [SyncJobStatus.pending, SyncJobStatus.running] },
        OR: [
          { startedAt: { lt: cutoff } },
          { startedAt: null, createdAt: { lt: cutoff } },
        ],
      },
    });

    for (const job of stale) {
      await this.prisma.syncJobItem.updateMany({
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
      await this.prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: SyncJobStatus.failed,
          failed: job.totalItems,
          completed: 0,
          errorMessage: STALE_MSG,
          completedAt: new Date(),
        },
      });
    }
    return stale.length;
  }

  async createJob(
    user: AuthUser,
    startDate: string,
    endDate: string,
    includeClicks = false,
    filter?: { channelAccountIds?: number[]; platformCodes?: string[] },
  ) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法触发采集');
    }

    await this.recoverStaleJobs();

    const accounts = this.filterAccountsForSync(
      await this.channelAccounts.listActiveForSync(user.id),
      filter,
    );
    if (!accounts.length) {
      throw new BadRequestException(
        '没有可采集的账号：请勾选已启用且已接入采集的平台账号',
      );
    }

    const job = await this.prisma.syncJob.create({
      data: {
        ownerUserId: user.id,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: SyncJobStatus.pending,
        totalItems: accounts.length,
        includeClicks,
        items: {
          create: accounts.map((a) => ({
            channelAccountId: a.id,
            status: SyncJobItemStatus.pending,
          })),
        },
      },
      include: {
        items: {
          include: {
            channelAccount: { include: { platform: true } },
          },
        },
      },
    });

    setImmediate(() => this.runJob(job.id).catch(console.error));
    return job;
  }

  /**
   * 为指定用户创建采集任务（管理员批量采集）
   */
  async createJobForOwner(
    ownerUserId: number,
    startDate: string,
    endDate: string,
    includeClicks = false,
    filter?: { channelAccountIds?: number[]; platformCodes?: string[] },
  ) {
    await this.recoverStaleJobs();

    const accounts = this.filterAccountsForSync(
      await this.channelAccounts.listActiveForSync(ownerUserId),
      filter,
    );
    if (!accounts.length) {
      throw new BadRequestException('该用户没有可采集的已启用平台账号');
    }

    const job = await this.prisma.syncJob.create({
      data: {
        ownerUserId,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        status: SyncJobStatus.pending,
        totalItems: accounts.length,
        includeClicks,
        items: {
          create: accounts.map((a) => ({
            channelAccountId: a.id,
            status: SyncJobItemStatus.pending,
          })),
        },
      },
      include: {
        items: {
          include: {
            channelAccount: { include: { platform: true } },
          },
        },
      },
    });

    setImmediate(() => this.runJob(job.id).catch(console.error));
    return job;
  }

  /**
   * 按所选账号或平台筛选；仅保留已接入采集器的平台
   */
  private filterAccountsForSync(
    accounts: { id: number; platform: { code: string } }[],
    filter?: { channelAccountIds?: number[]; platformCodes?: string[] },
  ) {
    let list = accounts.filter((a) => isCollectorImplemented(a.platform.code));

    const ids = filter?.channelAccountIds?.filter((id) => Number.isFinite(id));
    if (ids?.length) {
      const idSet = new Set(ids);
      list = list.filter((a) => idSet.has(a.id));
    } else {
      const codes = filter?.platformCodes
        ?.map((c) => c.trim().toLowerCase())
        .filter(Boolean);
      if (codes?.length) {
        const codeSet = new Set(codes);
        list = list.filter((a) => codeSet.has(a.platform.code));
      }
    }

    return list;
  }

  /**
   * 是否应在采集完成后自动导入 Sheet：仅「全平台/全账号」采集时触发。
   * 只采 RW 等部分平台时不重导广告费，避免与联盟订单刷新错位。
   */
  private async shouldAutoImportSheet(
    ownerUserId: number,
    syncedAccountIds: number[],
  ): Promise<boolean> {
    const allAccounts = this.filterAccountsForSync(
      await this.channelAccounts.listActiveForSync(ownerUserId),
    );
    if (!allAccounts.length) return false;
    if (syncedAccountIds.length < allAccounts.length) return false;
    const synced = new Set(syncedAccountIds);
    return allAccounts.every((a) => synced.has(a.id));
  }

  /** 最近采集任务（用于页面展示是否成功；管理员可指定员工 userId） */
  async listRecentJobs(user: AuthUser, limit = 5, ownerUserId?: number) {
    await this.recoverStaleJobs();
    const filterOwnerId = isAdmin(user) && ownerUserId != null ? ownerUserId : user.id;
    return this.prisma.syncJob.findMany({
      where: { ownerUserId: filterOwnerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        items: {
          include: {
            channelAccount: { include: { platform: true } },
          },
        },
      },
    });
  }

  /** 手动取消/终止进行中的任务（管理员可取消任意员工任务） */
  async cancelJob(user: AuthUser, jobId: number) {
    const job = await this.prisma.syncJob.findFirst({
      where: isAdmin(user) ? { id: jobId } : { id: jobId, ownerUserId: user.id },
    });
    if (!job) throw new NotFoundException('任务不存在');
    if (
      job.status === SyncJobStatus.completed ||
      job.status === SyncJobStatus.failed ||
      job.status === SyncJobStatus.partial
    ) {
      throw new BadRequestException('任务已结束，无需取消');
    }

    await this.prisma.syncJobItem.updateMany({
      where: {
        syncJobId: jobId,
        status: { in: [SyncJobItemStatus.pending, SyncJobItemStatus.running] },
      },
      data: {
        status: SyncJobItemStatus.failed,
        errorMessage: '用户已取消',
        completedAt: new Date(),
      },
    });

    return this.prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: SyncJobStatus.failed,
        failed: job.totalItems,
        errorMessage: '用户已取消',
        completedAt: new Date(),
      },
      include: {
        items: { include: { channelAccount: { include: { platform: true } } } },
      },
    });
  }

  async runJob(jobId: number) {
    const job = await this.prisma.syncJob.findUnique({
      where: { id: jobId },
      include: { items: { include: { channelAccount: { include: { platform: true } } } } },
    });
    if (!job) return;

    await this.prisma.syncJob.update({
      where: { id: jobId },
      data: { status: SyncJobStatus.running, startedAt: new Date() },
    });
    console.log(`[sync] 任务 #${jobId} 开始`);

    const start = job.startDate.toISOString().slice(0, 10);
    const end = job.endDate.toISOString().slice(0, 10);
    const includeClicks = job.includeClicks;

    const results: ('completed' | 'failed')[] = await Promise.all(
      job.items.map((item) =>
        this.runJobItem(jobId, job.ownerUserId, item, start, end, includeClicks),
      ),
    );

    let completed = 0;
    let failed = 0;
    for (const r of results) {
      if (r === 'completed') completed += 1;
      else failed += 1;
    }

    const status =
      failed === 0
        ? SyncJobStatus.completed
        : completed === 0
          ? SyncJobStatus.failed
          : SyncJobStatus.partial;

    const syncStart = job.startDate.toISOString().slice(0, 10);
    const syncEnd = job.endDate.toISOString().slice(0, 10);
    const syncedAccountIds = job.items.map((i) => i.channelAccountId);
    const autoImportSheet = await this.shouldAutoImportSheet(job.ownerUserId, syncedAccountIds);

    let sheetImportNote: string | null = null;
    if (autoImportSheet) {
      const r = await this.adSources.importForOwner(job.ownerUserId, syncStart, syncEnd);
      sheetImportNote = this.adSources.formatOwnerSheetImportNote(r, syncStart, syncEnd);
      if (r.skipped) {
        console.log(`[sync] 任务 #${jobId} ${sheetImportNote}`);
      } else {
        console.log(
          `[sync] 任务 #${jobId} 已自动导入 Sheet：${r.success}/${r.sheetCount} 个数据源，共 ${r.totalUpserted} 行（${syncStart}~${syncEnd}）`,
        );
        const warnings = r.results.filter((item) => item.ok && item.coverageWarning);
        for (const w of warnings) {
          console.log(`[sync] 任务 #${jobId} Sheet 覆盖告警 ${w.sourceName}: ${w.coverageWarning}`);
        }
      }
    } else {
      const allCount = (
        await this.filterAccountsForSync(
          await this.channelAccounts.listActiveForSync(job.ownerUserId),
        )
      ).length;
      console.log(
        `[sync] 任务 #${jobId} 跳过 Sheet 导入：非全账号采集（${syncedAccountIds.length}/${allCount}）`,
      );
    }

    await this.prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status,
        completed,
        failed,
        completedAt: new Date(),
        ...(autoImportSheet && sheetImportNote ? { errorMessage: sheetImportNote } : {}),
      },
    });

    console.log(`[sync] 任务 #${jobId} 结束: ${status}（成功 ${completed} / 失败 ${failed}）`);

    this.alerts
      .runCheckAfterSync(job.ownerUserId, syncStart, syncEnd)
      .then((r) => {
        if (r && r.triggered > 0) {
          console.log(`[sync] 佣金监控触发 ${r.triggered} 条告警（${syncStart}~${syncEnd}）`);
        }
      })
      .catch(console.error);
  }

  /**
   * 单账号采集（多账号并行，各平台独立 Token）
   */
  private async runJobItem(
    jobId: number,
    ownerUserId: number,
    item: {
      id: number;
      channelAccountId: number;
      channelAccount: { displayName: string; platform: { code: string; name: string } };
    },
    start: string,
    end: string,
    includeClicks: boolean,
  ): Promise<'completed' | 'failed'> {
    await this.prisma.syncJobItem.update({
      where: { id: item.id },
      data: { status: SyncJobItemStatus.running, startedAt: new Date() },
    });

    try {
      const { account, credentials } = await this.channelAccounts.getWithCredentials(
        ownerUserId,
        item.channelAccountId,
      );
      const result = await this.collectors.collectForAccount(
        account,
        credentials.apiToken,
        start,
        end,
        async (message) => {
          await this.prisma.syncJobItem.update({
            where: { id: item.id },
            data: { errorMessage: message },
          });
        },
        { includeClicks },
      );
      const parts: string[] = [];
      if (result.pmApi) {
        parts.push(
          `订单 ${result.pmApi.orderCount} 单 / $${result.pmApi.totalCommission.toFixed(2)}`,
        );
      }
      if (result.lhApi) {
        parts.push(
          `订单 ${result.lhApi.orderCount} 单 / $${result.lhApi.totalCommission.toFixed(2)}`,
        );
      }
      if (result.lbApi) {
        parts.push(
          `订单 ${result.lbApi.orderCount} 单 / $${result.lbApi.totalCommission.toFixed(2)}`,
        );
      }
      if (result.rwApi) {
        const src =
          result.rwApi.apiSource && result.rwApi.apiSource !== 'none'
            ? ` · ${result.rwApi.apiSource}`
            : '';
        const detailOrders = result.rwApi.detailOrderCount ?? result.rwApi.orderCount;
        const commission = result.rwApi.totalCommission.toFixed(2);
        let rwMsg = `RW 佣金 ${result.rwApi.apiListRows} 行 / 合并 ${detailOrders} 单 / $${commission}${src}`;
        if (result.rwPerformanceOrderCount !== undefined && result.rwPerformanceOrderCount > 0) {
          rwMsg += ` · Performance ${result.rwPerformanceOrderCount} 单（报表口径）`;
          if (detailOrders !== result.rwPerformanceOrderCount) {
            rwMsg += `，明细 ${detailOrders} 单`;
          }
        } else if (result.rwPerformanceOrderError) {
          rwMsg += ` · Performance 失败: ${result.rwPerformanceOrderError.slice(0, 80)}，明细 ${detailOrders} 单`;
        } else {
          rwMsg += ` · 明细 ${detailOrders} 单（Performance 未写入）`;
        }
        if (result.rwApi.sampleOrder) {
          const s = result.rwApi.sampleOrder;
          rwMsg += `（首单 mid=${s.merchantId ?? '空'} 日期=${s.orderDate}${s.merchantName ? ` ${s.merchantName}` : ''}）`;
        }
        if (result.rwApi.apiListRows === 0) {
          rwMsg +=
            '（全部接口为空，请核对 Token 是否为 Rewardoo 后台 Performance 有数据站点的 API Token，并确认 mod=medium/transaction_details 可用）';
        }
        parts.push(rwMsg);
      }
      if (result.pmClickTotal !== undefined) {
        parts.push(`PM 联盟点击 ${result.pmClickTotal}（${start}~${end}）`);
      }
      if (result.pmClickError) {
        parts.push(`PM 联盟点击失败: ${result.pmClickError}`);
      }
      if (result.lhClickTotal !== undefined) {
        parts.push(`LH 联盟点击 ${result.lhClickTotal}（${start}~${end}）`);
      }
      if (result.lbClickTotal !== undefined) {
        const clickDay = result.lbClickCollectDate ?? end;
        let lbClickMsg = `LB 联盟点击 ${result.lbClickTotal}（${clickDay}）`;
        if (result.lbClickEstimatedDays && result.lbClickEstimatedDays > 0) {
          lbClickMsg += '，商家明细为估算，可用导入校准';
        }
        parts.push(lbClickMsg);
      }
      const isRw = item.channelAccount.platform.code === 'rewardoo';
      if (result.rwClickTotal !== undefined) {
        parts.push(`RW 联盟点击 ${result.rwClickTotal}（${start}~${end}）`);
      } else if (isRw && includeClicks) {
        const clickHint = result.rwClickError
          ? `RW 联盟点击未写入: ${result.rwClickError.slice(0, 100)}`
          : 'RW 联盟点击未写入（Performance API 无点击数据，请确认已部署最新 API）';
        parts.push(clickHint);
      } else if (isRw && result.rwClickError) {
        parts.push(`RW 联盟点击未写入: ${result.rwClickError.slice(0, 100)}`);
      }
      const pmNote = parts.length ? parts.join('；') : '采集完成（无订单数据）';
      await this.prisma.syncJobItem.update({
        where: { id: item.id },
        data: {
          status: SyncJobItemStatus.completed,
          ordersFetched: result.fetched,
          ordersInserted: result.inserted,
          ordersUpdated: result.updated,
          errorMessage: pmNote,
          completedAt: new Date(),
        },
      });
      console.log(
        `[sync] 任务 #${jobId} 账号 ${item.channelAccount.displayName} 完成: ${pmNote ?? 'ok'}`,
      );
      return 'completed';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[sync] 任务 #${jobId} 账号 ${item.channelAccount.displayName} 失败:`, msg);
      await this.prisma.syncJobItem.update({
        where: { id: item.id },
        data: {
          status: SyncJobItemStatus.failed,
          errorMessage: msg,
          completedAt: new Date(),
        },
      });
      return 'failed';
    }
  }

  async getJob(user: AuthUser, jobId: number) {
    await this.recoverStaleJobs();
    const job = await this.prisma.syncJob.findFirst({
      where: isAdmin(user) ? { id: jobId } : { id: jobId, ownerUserId: user.id },
      include: {
        items: {
          include: {
            channelAccount: { include: { platform: true } },
          },
        },
      },
    });
    if (!job) throw new NotFoundException('任务不存在');
    return job;
  }
}
