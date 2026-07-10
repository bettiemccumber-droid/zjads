import { Injectable } from '@nestjs/common';
import { NormalizedStatus, Prisma, UserRole } from '@prisma/client';
import {
  aggregateAffiliateOrders,
  mergePlatformCatalog,
  PlatformCommissionSummary,
  summarizeMerchantsByPlatform,
} from '../common/commission-aggregate.util';
import {
  aggregateRwPerformanceByMerchant,
  applyRwPerformanceCommissionOverlay,
} from '../common/rw-performance-settlement.util';
import { renormalizeOrdersForAccounts } from '../common/platform-status-defaults.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';

export interface OrdersQuery {
  startDate?: string;
  endDate?: string;
  userId?: number;
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
    const ownerIds = await this.resolveOwnerUserIds(user, q.userId);
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

    return {
      ...core,
      scope: isCompanyWideScope(user, q.userId) ? 'company' : 'user',
      selectedUserId: q.userId ?? null,
      employeeSummaries,
    };
  }

  /** 解析结算数据归属：管理员默认全公司员工 */
  private async resolveOwnerUserIds(user: AuthUser, queryUserId?: number): Promise<number[]> {
    if (isCompanyWideScope(user, queryUserId)) {
      const employees = await this.prisma.user.findMany({
        where: { isActive: true, role: { not: UserRole.ADMIN } },
        select: { id: true },
      });
      return employees.map((e) => e.id);
    }
    return [resolveOwnerUserId(user, queryUserId)];
  }

  private async buildSettlementForOwnerIds(ownerIds: number[], q: OrdersQuery) {
    const allAccounts = await this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        ...(q.channelAccountId ? { id: q.channelAccountId } : {}),
      },
      include: { platform: true },
    });
    if (!allAccounts.length) {
      return {
        items: [] as SettlementMerchantRow[],
        stats: this.emptyStats(),
        platformSummaries: [] as PlatformCommissionSummary[],
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

    let merchants = aggregateAffiliateOrders(orders);
    if (dateRange) {
      const rwClickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
        where: {
          channelAccountId: { in: accountIds },
          clickDate: dateRange,
          channelAccount: { platform: { code: 'rewardoo' } },
        },
        include: { channelAccount: { include: { platform: true } } },
      });
      const perfByKey = aggregateRwPerformanceByMerchant(rwClickRows);
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

    let scoped = merchants;
    if (q.platformCode) {
      scoped = merchants.filter((m) => m.platformCode === q.platformCode);
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

    return { items, stats, platformSummaries };
  }

  private toSettlementRow(m: ReturnType<typeof aggregateAffiliateOrders>[number]): SettlementMerchantRow {
    return {
      merchantId: m.merchantId,
      merchantName: m.merchantName,
      platformName: m.platformName,
      platformCode: m.platformCode,
      affiliateAlias: m.affiliateAlias,
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
