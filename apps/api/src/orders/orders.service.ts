import { BadRequestException, Injectable } from '@nestjs/common';
import { NormalizedStatus, Prisma, UserRole } from '@prisma/client';
import {
  aggregateAffiliateOrders,
  aggregateAffiliateOrdersForMonitor,
  mergePlatformCatalog,
  PlatformCommissionSummary,
  ChannelAccountCommissionSummary,
  summarizeMerchantsByPlatform,
} from '../common/commission-aggregate.util';
import {
  filterAccountsByDeploymentUnit,
  rollupMerchantsByDeploymentUnit,
  summarizeMerchantsByDeploymentUnit,
} from '../common/deployment-unit.util';
import {
  aggregateRwPerformanceByMerchant,
  applyRwPerformanceCommissionOverlay,
  mergeRwPerformanceByMerchantId,
} from '../common/rw-performance-settlement.util';
import { renormalizeOrdersForAccounts } from '../common/platform-status-defaults.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { resolveTeamOwnerUserIds } from '../common/team-scope.util';
import { PrismaService } from '../prisma/prisma.service';

export interface OrdersQuery {
  startDate?: string;
  endDate?: string;
  userId?: number;
  /** 未指定 userId 时按团队（组长+组员）汇总 */
  teamWide?: boolean;
  /** 未指定 userId 时汇总本组织全部活跃员工（拒付商家等共享视图） */
  orgWide?: boolean;
  /** 拒付下钻：按员工/渠道账号拆分（需 merchantId + platformCode） */
  merchantBreakdown?: boolean;
  channelAccountId?: number;
  platformCode?: string;
  normalizedStatus?: NormalizedStatus;
  merchantId?: string;
  merchantName?: string;
  externalOrderId?: string;
  page?: number;
  pageSize?: number;
}

export interface SettlementMerchantRow {
  merchantId: string;
  merchantName: string;
  platformName: string;
  platformCode: string;
  affiliateAlias: string;
  channelAccountId?: number;
  channelDisplayName?: string;
  ownerUserId?: number;
  ownerUsername?: string;
  orderCount: number;
  totalAmount: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  settlementRate: number;
  pendingRate: number;
  rejectionRate: number;
}

export interface SettlementStats {
  totalOrders: number;
  totalCommission: number;
  confirmedCommission: number;
  pendingCommission: number;
  rejectedCommission: number;
  settlementRate: number;
  pendingRate: number;
  rejectionRate: number;
}

export interface SettlementEmployeeSummary {
  userId: number;
  username: string;
  stats: SettlementStats;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private ownerChannelFilter(ownerUserId: number, channelAccountId?: number): Prisma.AffiliateOrderWhereInput {
    return {
      channelAccount: {
        ownerUserId,
        ...(channelAccountId ? { id: channelAccountId } : {}),
      },
    };
  }

  async list(user: AuthUser, q: OrdersQuery) {
    const ownerId = resolveOwnerUserId(user, q.userId);
    const page = Math.max(1, q.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, q.pageSize ?? 20));
    const where: Prisma.AffiliateOrderWhereInput = {
      ...this.ownerChannelFilter(ownerId, q.channelAccountId),
    };
    const dateRange = buildOrderDateRangeFilter(q.startDate, q.endDate);
    if (dateRange) where.orderDate = dateRange;
    if (q.normalizedStatus) where.normalizedStatus = q.normalizedStatus;
    if (q.merchantId) where.merchantId = { contains: q.merchantId };
    if (q.merchantName) where.merchantName = { contains: q.merchantName };
    if (q.externalOrderId) where.externalOrderId = { contains: q.externalOrderId };

    const [items, total] = await Promise.all([
      this.prisma.affiliateOrder.findMany({
        where,
        include: {
          channelAccount: {
            include: { platform: true },
          },
        },
        orderBy: { orderDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.affiliateOrder.count({ where }),
    ]);

    return {
      items: items.map((o) => ({
        id: o.id,
        externalOrderId: o.externalOrderId,
        orderDate: o.orderDate,
        platformName: o.channelAccount.platform.name,
        platformCode: o.channelAccount.platform.code,
        affiliateAlias: o.channelAccount.affiliateAlias,
        channelAccountId: o.channelAccountId,
        merchantId: o.merchantId,
        merchantName: o.merchantName,
        orderAmount: Number(o.orderAmount),
        commission: Number(o.commission),
        rawStatus: o.rawStatus,
        normalizedStatus: o.normalizedStatus,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 商家维度结算汇总（按订单号去重；RW 总佣金/订单数与看板一致，取 Performance 逐日汇总）
   * 管理员未指定 userId 时汇总全公司员工，并返回分员工明细
   */
  async settlementMerchantSummary(user: AuthUser, q: OrdersQuery) {
    if (q.merchantBreakdown) {
      return this.buildMerchantChargebackBreakdown(user, q);
    }

    const ownerIds = await this.resolveOwnerUserIds(user, q.userId, {
      teamWide: q.teamWide,
      orgWide: q.orgWide,
    });
    const core = await this.buildSettlementForOwnerIds(ownerIds, q);

    let employeeSummaries: SettlementEmployeeSummary[] | undefined;
    if (isCompanyWideScope(user, q.userId) && ownerIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, username: true },
        orderBy: { username: 'asc' },
      });
      employeeSummaries = [];
      for (const u of users) {
        const one = await this.buildSettlementForOwnerIds([u.id], q);
        employeeSummaries.push({
          userId: u.id,
          username: u.username,
          stats: one.stats,
        });
      }
      employeeSummaries.sort(
        (a, b) =>
          b.stats.rejectedCommission - a.stats.rejectedCommission ||
          b.stats.totalCommission - a.stats.totalCommission,
      );
    }

    const companyWide =
      q.userId == null &&
      (isCompanyWideScope(user, q.userId) || q.orgWide === true || ownerIds.length > 1);

    return {
      ...core,
      scope: companyWide ? 'company' : 'user',
      selectedUserId: q.userId ?? null,
      employeeSummaries,
    };
  }

  /** 解析结算数据归属：管理员默认全组织员工；orgWide 对任意角色开放全员汇总 */
  private async resolveOwnerUserIds(
    user: AuthUser,
    queryUserId?: number,
    scope?: { teamWide?: boolean; orgWide?: boolean },
  ): Promise<number[]> {
    if (queryUserId == null && (isCompanyWideScope(user, queryUserId) || scope?.orgWide)) {
      return this.listActiveEmployeeIdsInOrganization(user.organizationId);
    }
    if (queryUserId != null) {
      return [resolveOwnerUserId(user, queryUserId)];
    }
    if (scope?.teamWide) {
      return resolveTeamOwnerUserIds(this.prisma, user.id, user.teamMemberIds);
    }
    return [user.id];
  }

  /**
   * 拒付商家下钻：同一 MID 按渠道账号/员工拆分（不做全员 MID 合并）
   */
  private async buildMerchantChargebackBreakdown(user: AuthUser, q: OrdersQuery) {
    const merchantId = q.merchantId?.trim();
    const platformCode = q.platformCode?.trim();
    if (!merchantId || !platformCode) {
      throw new BadRequestException('分别拒付需提供 merchantId 与 platformCode');
    }

    const ownerIds = await this.resolveOwnerUserIds(user, q.userId, {
      teamWide: q.teamWide,
      orgWide: q.orgWide,
    });

    const ownerAccounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        platform: { code: platformCode },
      },
      include: {
        platform: true,
        ownerUser: { select: { id: true, username: true } },
      },
    });

    if (!ownerAccounts.length) {
      return {
        items: [] as SettlementMerchantRow[],
        stats: this.emptyStats(),
        platformSummaries: [] as PlatformCommissionSummary[],
        channelSummaries: [] as ChannelAccountCommissionSummary[],
        scope: 'breakdown' as const,
        breakdownTotals: null,
        selectedUserId: q.userId ?? null,
      };
    }

    const accountIds = ownerAccounts.map((a) => a.id);
    await renormalizeOrdersForAccounts(this.prisma, accountIds);

    const dateRange = buildOrderDateRangeFilter(q.startDate, q.endDate);
    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        merchantId,
        ...(dateRange ? { orderDate: dateRange } : {}),
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    let merchants = aggregateAffiliateOrders(orders, { groupByChannelAccount: true });
    const accountById = new Map(ownerAccounts.map((a) => [a.id, a]));

    if (dateRange) {
      const rwClickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
        where: {
          channelAccountId: { in: accountIds },
          merchantId,
          clickDate: dateRange,
          channelAccount: { platform: { code: 'rewardoo' } },
        },
        include: { channelAccount: { include: { platform: true } } },
      });
      const perfByKey = aggregateRwPerformanceByMerchant(rwClickRows);
      merchants = applyRwPerformanceCommissionOverlay(merchants, perfByKey);
    }

    const merged = aggregateAffiliateOrdersForMonitor(orders);
    const breakdownTotals =
      merged.find((m) => m.merchantId === merchantId && m.platformCode === platformCode) ??
      merged[0];

    const items = merchants
      .filter((m) => m.rejectedCommission > 0)
      .map((m) => {
        const account =
          m.channelAccountId != null ? accountById.get(m.channelAccountId) : undefined;
        return {
          ...this.toSettlementRow(m),
          ownerUserId: account?.ownerUserId,
          ownerUsername: account?.ownerUser.username,
        };
      })
      .sort(
        (a, b) =>
          b.rejectedCommission - a.rejectedCommission ||
          b.rejectionRate - a.rejectionRate,
      );

    const stats = this.aggregateSettlementStats(items);

    return {
      items,
      stats,
      platformSummaries: [] as PlatformCommissionSummary[],
      channelSummaries: [] as ChannelAccountCommissionSummary[],
      scope: 'breakdown' as const,
      breakdownTotals: breakdownTotals ? this.toSettlementRow(breakdownTotals) : null,
      selectedUserId: q.userId ?? null,
    };
  }

  /** 本组织内活跃非管理员员工（联盟/拒付数据归属） */
  private async listActiveEmployeeIdsInOrganization(organizationId: number): Promise<number[]> {
    const employees = await this.prisma.user.findMany({
      where: { organizationId, isActive: true, role: { not: UserRole.ADMIN } },
      select: { id: true },
    });
    return employees.map((e) => e.id);
  }

  private async buildSettlementForOwnerIds(ownerIds: number[], q: OrdersQuery) {
    const ownerAccounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: { in: ownerIds } },
      include: { platform: true },
    });
    const allAccounts = filterAccountsByDeploymentUnit(ownerAccounts, q.channelAccountId);
    if (!allAccounts.length) {
      return {
        items: [] as SettlementMerchantRow[],
        stats: this.emptyStats(),
        platformSummaries: [] as PlatformCommissionSummary[],
        channelSummaries: [] as ChannelAccountCommissionSummary[],
      };
    }

    const accountIds = allAccounts.map((a) => a.id);
    await renormalizeOrdersForAccounts(this.prisma, accountIds);

    const dateRange = buildOrderDateRangeFilter(q.startDate, q.endDate);
    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        ...(dateRange ? { orderDate: dateRange } : {}),
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    /** 多员工/全员：按平台+MID 合并（竞品拒付商家同款），并按平台内订单号去重 */
    const mergeMerchantsOrgWide = ownerIds.length > 1;
    let merchants = mergeMerchantsOrgWide
      ? aggregateAffiliateOrdersForMonitor(orders)
      : aggregateAffiliateOrders(orders, { groupByChannelAccount: true });
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));
    if (!mergeMerchantsOrgWide) {
      merchants = rollupMerchantsByDeploymentUnit(merchants, accountById);
    }
    if (dateRange) {
      const rwClickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
        where: {
          channelAccountId: { in: accountIds },
          clickDate: dateRange,
          channelAccount: { platform: { code: 'rewardoo' } },
        },
        include: { channelAccount: { include: { platform: true } } },
      });
      let perfByKey = aggregateRwPerformanceByMerchant(rwClickRows);
      if (mergeMerchantsOrgWide) {
        perfByKey = mergeRwPerformanceByMerchantId(perfByKey);
        merchants = merchants.map((m) =>
          m.platformCode === 'rewardoo'
            ? { ...m, affiliateAlias: '', channelDisplayName: '' }
            : m,
        );
      }
      merchants = applyRwPerformanceCommissionOverlay(merchants, perfByKey);
    }

    const platformSummaries = mergePlatformCatalog(
      summarizeMerchantsByPlatform(merchants, new Set()),
      allAccounts.map((a) => ({
        affiliateAlias: a.affiliateAlias,
        displayName: a.displayName,
        platform: a.platform,
      })),
    );

    const channelSummaries = summarizeMerchantsByDeploymentUnit(
      merchants,
      allAccounts.map((a) => ({
        id: a.id,
        affiliateAlias: a.affiliateAlias,
        displayName: a.displayName,
        platform: a.platform,
      })),
    );

    let scoped = merchants;
    if (q.platformCode) {
      scoped = scoped.filter((m) => m.platformCode === q.platformCode);
    }

    const items = scoped
      .map((m) => this.toSettlementRow(m))
      .sort(
        (a, b) =>
          b.rejectedCommission - a.rejectedCommission ||
          b.totalCommission - a.totalCommission ||
          b.orderCount - a.orderCount,
      );

    const stats = this.aggregateSettlementStats(items);

    return { items, stats, platformSummaries, channelSummaries };
  }

  private toSettlementRow(m: ReturnType<typeof aggregateAffiliateOrders>[number]): SettlementMerchantRow {
    return {
      merchantId: m.merchantId,
      merchantName: m.merchantName,
      platformName: m.platformName,
      platformCode: m.platformCode,
      affiliateAlias: m.affiliateAlias,
      channelAccountId: m.channelAccountId,
      channelDisplayName: m.channelDisplayName,
      orderCount: m.orderCount,
      totalAmount: 0,
      totalCommission: m.totalCommission,
      confirmedCommission: m.confirmedCommission,
      pendingCommission: m.pendingCommission,
      rejectedCommission: m.rejectedCommission,
      settlementRate:
        m.totalCommission > 0 ? (m.confirmedCommission / m.totalCommission) * 100 : 0,
      pendingRate: m.totalCommission > 0 ? (m.pendingCommission / m.totalCommission) * 100 : 0,
      rejectionRate: m.rejectionRate,
    };
  }

  private aggregateSettlementStats(items: SettlementMerchantRow[]): SettlementStats {
    const base = items.reduce(
      (acc, r) => {
        acc.totalOrders += r.orderCount;
        acc.totalCommission += r.totalCommission;
        acc.confirmedCommission += r.confirmedCommission;
        acc.pendingCommission += r.pendingCommission;
        acc.rejectedCommission += r.rejectedCommission;
        return acc;
      },
      {
        totalOrders: 0,
        totalCommission: 0,
        confirmedCommission: 0,
        pendingCommission: 0,
        rejectedCommission: 0,
      },
    );

    return {
      ...base,
      settlementRate:
        base.totalCommission > 0
          ? (base.confirmedCommission / base.totalCommission) * 100
          : 0,
      pendingRate:
        base.totalCommission > 0
          ? (base.pendingCommission / base.totalCommission) * 100
          : 0,
      rejectionRate:
        base.totalCommission > 0
          ? (base.rejectedCommission / base.totalCommission) * 100
          : 0,
    };
  }

  private emptyStats(): SettlementStats {
    return {
      totalOrders: 0,
      totalCommission: 0,
      confirmedCommission: 0,
      pendingCommission: 0,
      rejectedCommission: 0,
      settlementRate: 0,
      pendingRate: 0,
      rejectionRate: 0,
    };
  }
}
