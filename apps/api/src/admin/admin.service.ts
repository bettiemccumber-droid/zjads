import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AdSourcesService } from '../ad-sources/ad-sources.service';
import { AuthUser } from '../common/ownership.util';
import { resolveOrderCommissionBuckets } from '../common/order-commission-buckets.util';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { SyncService } from '../sync/sync.service';

export interface AdminDateRange {
  startDate: string;
  endDate: string;
}

/**
 * 管理员：平台概览、用户汇总、批量采集
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
    private readonly sync: SyncService,
    private readonly adSources: AdSourcesService,
  ) {}

  /** 平台统计概览 */
  async platformOverview(q: AdminDateRange) {
    const dashboard = await this.reports.companyDashboard(q);
    const dateRange = this.orderDateRange(q.startDate, q.endDate);

    const [totalUsers, activeUsers, channelAccountCount, adSourceCount, adAgg, newUsersMonth] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { isActive: true, role: { not: UserRole.ADMIN } } }),
        this.prisma.channelAccount.count({ where: { isActive: true } }),
        this.prisma.adDataSource.count({ where: { isActive: true } }),
        this.prisma.adCampaignDaily.aggregate({
          where: { date: dateRange },
          _sum: { impressions: true, clicks: true, cost: true },
        }),
        this.prisma.user.count({
          where: {
            role: { not: UserRole.ADMIN },
            createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
          },
        }),
      ]);

    const { company } = dashboard;
    return {
      period: q,
      users: {
        total: totalUsers,
        active: activeUsers,
        newThisMonth: newUsersMonth,
        channelAccountCount,
        adSourceCount,
      },
      orders: {
        orderCount: company.orderCount,
        totalCommission: company.totalCommission,
        pendingCommission: company.pendingCommission,
        confirmedCommission: company.confirmedCommission,
        rejectedCommission: company.rejectedCommission,
      },
      ads: {
        totalAdSpend: company.totalAdSpend,
        impressions: Number(adAgg._sum.impressions ?? 0),
        clicks: Number(adAgg._sum.clicks ?? 0),
        overallRoi: company.overallRoi,
      },
      revenue: {
        totalCommission: company.totalCommission,
        totalAdSpend: company.totalAdSpend,
        profit: company.profit,
      },
      byEmployee: dashboard.byEmployee,
    };
  }

  /** 用户列表（含业务指标） */
  async usersSummary(q: AdminDateRange) {
    const users = await this.prisma.user.findMany({
      where: { role: { not: UserRole.ADMIN } },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    });

    const rows = [];
    for (const u of users) {
      const [channelCount, adSourceCount, orderAgg, report, lastJob] = await Promise.all([
        this.prisma.channelAccount.count({ where: { ownerUserId: u.id, isActive: true } }),
        this.prisma.adDataSource.count({ where: { ownerUserId: u.id, isActive: true } }),
        this.prisma.affiliateOrder.aggregate({
          where: {
            channelAccount: { ownerUserId: u.id },
            orderDate: this.orderDateRange(q.startDate, q.endDate),
          },
          _count: true,
          _sum: { commission: true },
        }),
        this.reports.merchantSummary(
          { id: u.id, role: UserRole.OPERATOR, organizationId: 1 } as AuthUser,
          { ...q, userId: u.id },
        ),
        this.prisma.syncJob.findFirst({
          where: { ownerUserId: u.id },
          orderBy: { createdAt: 'desc' },
          select: { status: true, createdAt: true, completedAt: true },
        }),
      ]);

      rows.push({
        ...u,
        channelAccountCount: channelCount,
        adSourceCount,
        orderCount: orderAgg._count,
        totalCommission: Number(orderAgg._sum.commission ?? 0),
        totalAdSpend: report.totals.totalAdSpend,
        roi: report.totals.overallRoi,
        profit: report.totals.profit,
        lastSyncStatus: lastJob?.status ?? null,
        lastSyncAt: lastJob?.completedAt ?? lastJob?.createdAt ?? null,
      });
    }

    return rows.sort((a, b) => b.totalCommission - a.totalCommission);
  }

  /** 各员工采集/数据源状态 */
  async collectionStatus() {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { not: UserRole.ADMIN } },
      select: { id: true, username: true },
      orderBy: { username: 'asc' },
    });

    const rows = [];
    for (const u of users) {
      const [channels, sources, lastJob, lastSource] = await Promise.all([
        this.prisma.channelAccount.count({ where: { ownerUserId: u.id, isActive: true } }),
        this.prisma.adDataSource.findMany({
          where: { ownerUserId: u.id, isActive: true },
          select: { id: true, name: true, updatedAt: true },
        }),
        this.prisma.syncJob.findFirst({
          where: { ownerUserId: u.id },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.adDataSource.findFirst({
          where: { ownerUserId: u.id },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true, name: true },
        }),
      ]);

      rows.push({
        userId: u.id,
        username: u.username,
        channelAccountCount: channels,
        adSourceCount: sources.length,
        adSources: sources,
        lastSyncStatus: lastJob?.status ?? null,
        lastSyncAt: lastJob?.completedAt ?? lastJob?.createdAt ?? null,
        lastSheetImportAt: lastSource?.updatedAt ?? null,
        lastSheetName: lastSource?.name ?? null,
      });
    }
    return rows;
  }

  /** 批量为所有员工创建联盟订单采集任务 */
  async batchSyncOrders(
    admin: AuthUser,
    q: AdminDateRange,
    opts: { includeClicks?: boolean; userIds?: number[] } = {},
  ) {
    let users = await this.prisma.user.findMany({
      where: { isActive: true, role: UserRole.OPERATOR },
      select: { id: true, username: true },
    });
    if (opts.userIds?.length) {
      const idSet = new Set(opts.userIds);
      users = users.filter((u) => idSet.has(u.id));
    }

    const results: Array<{
      userId: number;
      username: string;
      ok: boolean;
      jobId?: number;
      message?: string;
    }> = [];

    for (const u of users) {
      try {
        const job = await this.sync.createJobForOwner(
          u.id,
          q.startDate,
          q.endDate,
          opts.includeClicks ?? false,
        );
        results.push({ userId: u.id, username: u.username, ok: true, jobId: job.id });
      } catch (e) {
        results.push({
          userId: u.id,
          username: u.username,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      started: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /** 批量导入全员 Google Sheet 广告数据 */
  async batchImportSheets(
    admin: AuthUser,
    startDate?: string,
    endDate?: string,
    userIds?: number[],
  ) {
    const where: { isActive: boolean; ownerUserId?: { in: number[] } } = { isActive: true };
    if (userIds?.length) where.ownerUserId = { in: userIds };

    const sources = await this.prisma.adDataSource.findMany({
      where,
      include: { ownerUser: { select: { username: true } } },
    });

    const results: Array<{
      sourceId: number;
      userId: number;
      username: string;
      sourceName: string;
      ok: boolean;
      upserted?: number;
      message?: string;
    }> = [];

    for (const source of sources) {
      try {
        const r = await this.adSources.importFromSource(admin, source.id, startDate, endDate);
        results.push({
          sourceId: source.id,
          userId: source.ownerUserId,
          username: source.ownerUser.username,
          sourceName: source.name,
          ok: true,
          upserted: r.upserted,
        });
      } catch (e) {
        results.push({
          sourceId: source.id,
          userId: source.ownerUserId,
          username: source.ownerUser.username,
          sourceName: source.name,
          ok: false,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return {
      success: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  /** 单用户详情摘要 */
  async userDetail(userId: number, q: AdminDateRange) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, role: true, isActive: true, createdAt: true },
    });
    if (!user || user.role === UserRole.ADMIN) return null;

    const authUser = { id: user.id, role: user.role, organizationId: 1 } as AuthUser;
    const [channels, sources, report, orders] = await Promise.all([
      this.prisma.channelAccount.findMany({
        where: { ownerUserId: userId },
        include: { platform: true },
        orderBy: { id: 'desc' },
      }),
      this.prisma.adDataSource.findMany({ where: { ownerUserId: userId } }),
      this.reports.merchantSummary(authUser, { ...q, userId }),
      this.prisma.affiliateOrder.findMany({
        where: {
          channelAccount: { ownerUserId: userId },
          orderDate: this.orderDateRange(q.startDate, q.endDate),
        },
        take: 5000,
      }),
    ]);

    let pending = 0;
    let confirmed = 0;
    let rejected = 0;
    for (const o of orders) {
      const b = resolveOrderCommissionBuckets(o);
      pending += b.pending;
      confirmed += b.approved;
      rejected += b.rejected;
    }

    return {
      user,
      channels: channels.map((c) => ({
        id: c.id,
        displayName: c.displayName,
        platformName: c.platform.name,
        affiliateAlias: c.affiliateAlias,
        isActive: c.isActive,
      })),
      adSources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        mainTab: s.mainTab,
        updatedAt: s.updatedAt,
      })),
      stats: {
        ...report.totals,
        pendingCommission: pending,
        confirmedCommission: confirmed,
        rejectedCommission: rejected,
      },
      merchantRows: report.summary.slice(0, 50),
    };
  }

  /**
   * 全公司商家分析：按商家 ID 聚合，下列各员工广告系列
   */
  async merchantAnalysis(
    q: AdminDateRange,
    opts: { search?: string; page?: number; pageSize?: number; exportAll?: boolean } = {},
  ) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(5, opts.pageSize ?? 10));
    const search = (opts.search ?? '').trim().toLowerCase();

    const employees = await this.prisma.user.findMany({
      where: { isActive: true, role: { not: UserRole.ADMIN } },
      select: { id: true, username: true },
    });

    type CampaignRow = {
      userId: number;
      username: string;
      campaignId: string;
      campaignName: string;
      affiliateAlias: string;
      dailyBudget: number;
      impressions: number;
      clicks: number;
      cost: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      cr: number;
      epc: number;
      cpc: number;
      roi: number;
    };

    type MerchantGroup = {
      merchantId: string;
      totalBudget: number;
      totalCost: number;
      totalCommission: number;
      totalOrders: number;
      roi: number;
      campaigns: CampaignRow[];
    };

    const merchantMap = new Map<string, MerchantGroup>();

    for (const emp of employees) {
      const report = await this.reports.campaignSummary(
        { id: emp.id, role: UserRole.OPERATOR, organizationId: 1 } as AuthUser,
        {
          startDate: q.startDate,
          endDate: q.endDate,
          userId: emp.id,
          statusMode: 'all',
        },
      );

      for (const c of report.summary) {
        const mid = (c.merchantId || '').trim() || '—';
        const hay = `${mid} ${emp.username} ${c.campaignName} ${c.affiliateAlias}`.toLowerCase();
        if (search && !hay.includes(search)) continue;

        if (!merchantMap.has(mid)) {
          merchantMap.set(mid, {
            merchantId: mid,
            totalBudget: 0,
            totalCost: 0,
            totalCommission: 0,
            totalOrders: 0,
            roi: 0,
            campaigns: [],
          });
        }

        const group = merchantMap.get(mid)!;
        const clicks = c.clicks ?? 0;
        const cost = Number(c.cost ?? 0);
        const commission = Number(c.commission ?? 0);
        const orders = c.orderCount ?? 0;
        const cr = clicks > 0 ? (orders / clicks) * 100 : 0;
        const epc = clicks > 0 ? commission / clicks : 0;
        const cpc = clicks > 0 ? cost / clicks : 0;
        const roi = cost > 0 ? (commission - cost) / cost : 0;

        group.campaigns.push({
          userId: emp.id,
          username: emp.username,
          campaignId: c.campaignId,
          campaignName: c.campaignName,
          affiliateAlias: c.affiliateAlias,
          dailyBudget: Number(c.dailyBudget ?? 0),
          impressions: c.impressions ?? 0,
          clicks,
          cost,
          orderCount: orders,
          commission,
          affiliateClicks: c.affiliateClicks ?? 0,
          cr: Math.round(cr * 100) / 100,
          epc: Math.round(epc * 10000) / 10000,
          cpc: Math.round(cpc * 10000) / 10000,
          roi: Math.round(roi * 100) / 100,
        });
      }
    }

    let merchants = [...merchantMap.values()].map((m) => {
      const campaigns = this.mergeMerchantCampaignRows(m.campaigns).sort(
        (a, b) => b.commission - a.commission || b.cost - a.cost,
      );
      const totalBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0);
      const totalCost = campaigns.reduce((s, c) => s + c.cost, 0);
      const totalCommission = campaigns.reduce((s, c) => s + c.commission, 0);
      const totalOrders = campaigns.reduce((s, c) => s + c.orderCount, 0);
      return {
        merchantId: m.merchantId,
        totalBudget,
        totalCost,
        totalCommission,
        totalOrders,
        roi:
          totalCost > 0
            ? Math.round(((totalCommission - totalCost) / totalCost) * 100) / 100
            : 0,
        campaigns,
      };
    });

    merchants.sort((a, b) => b.totalCommission - a.totalCommission || b.totalCost - a.totalCost);

    const total = merchants.length;
    const formatItem = (
      m: (typeof merchants)[number],
      rank: number,
    ) => ({
      ...m,
      rank,
      totalBudget: Math.round(m.totalBudget * 100) / 100,
      totalCost: Math.round(m.totalCost * 100) / 100,
      totalCommission: Math.round(m.totalCommission * 100) / 100,
    });

    if (opts.exportAll) {
      return {
        total,
        page: 1,
        pageSize: total,
        items: merchants.map((m, i) => formatItem(m, i + 1)),
      };
    }

    const start = (page - 1) * pageSize;
    const items = merchants.slice(start, start + pageSize).map((m, i) => formatItem(m, start + i + 1));

    return { total, page, pageSize, items };
  }

  /**
   * 同名广告系列可能来自不同 Google 子账号（customerId 不同），合并为一行展示
   */
  private mergeMerchantCampaignRows(
    rows: Array<{
      userId: number;
      username: string;
      campaignId: string;
      campaignName: string;
      affiliateAlias: string;
      dailyBudget: number;
      impressions: number;
      clicks: number;
      cost: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      cr: number;
      epc: number;
      cpc: number;
      roi: number;
    }>,
  ) {
    type Row = (typeof rows)[number];
    const map = new Map<string, Row>();

    for (const row of rows) {
      const key = `${row.userId}|${row.campaignName.trim().toLowerCase()}|${(row.affiliateAlias || '').toLowerCase()}`;
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...row });
        continue;
      }

      prev.dailyBudget = Math.max(prev.dailyBudget, row.dailyBudget);
      prev.impressions += row.impressions;
      prev.clicks += row.clicks;
      prev.cost += row.cost;
      prev.orderCount += row.orderCount;
      prev.commission += row.commission;
      prev.affiliateClicks += row.affiliateClicks;
      if (row.cost > prev.cost) prev.campaignId = row.campaignId;

      const { clicks, cost, commission, orderCount } = prev;
      prev.cr = clicks > 0 ? Math.round((orderCount / clicks) * 10000) / 100 : 0;
      prev.epc = clicks > 0 ? Math.round((commission / clicks) * 10000) / 10000 : 0;
      prev.cpc = clicks > 0 ? Math.round((cost / clicks) * 10000) / 10000 : 0;
      prev.roi = cost > 0 ? Math.round(((commission - cost) / cost) * 100) / 100 : 0;
    }

    return [...map.values()];
  }

  private orderDateRange(startDate: string, endDate: string) {
    return {
      gte: new Date(`${startDate}T00:00:00.000Z`),
      lte: new Date(`${endDate}T23:59:59.999Z`),
    };
  }
}
