import { BadRequestException, Injectable } from '@nestjs/common';
import { CommissionAlertStatus, UserRole } from '@prisma/client';
import {
  commissionAlertMerchantId,
  platformCommissionAlertFilter,
} from '../common/commission-alert-key.util';
import {
  aggregateAffiliateOrders,
  mergePlatformCatalog,
  summarizeMerchantsByPlatform,
} from '../common/commission-aggregate.util';
import { renormalizeOrdersForAccounts } from '../common/platform-status-defaults.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { resolveOwnerUserId, AuthUser, isAdmin, isCompanyWideScope } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  evaluateCommissionRisk,
  MerchantCommissionAgg,
  ruleFromDb,
} from './commission-monitor.util';

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateRule(userId: number) {
    let rule = await this.prisma.commissionAlertRule.findUnique({ where: { userId } });
    if (!rule) {
      rule = await this.prisma.commissionAlertRule.create({ data: { userId } });
    }
    return rule;
  }

  async saveRule(
    userId: number,
    data: {
      isEnabled: boolean;
      windowDays: number;
      rejectedAmountThreshold: number;
      rejectedRateThreshold: number;
      minRejectedOrders?: number;
      minOrdersForRate?: number;
      minRejectedForRate?: number;
      autoCheckOnSync?: boolean;
    },
  ) {
    return this.prisma.commissionAlertRule.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  private computeWindow(windowDays: number) {
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - Math.max(1, windowDays) + 1);
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10),
    };
  }

  private parseWindowDate(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  private async loadUserAccounts(userId: number, platformCode?: string) {
    return this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: userId,
        ...(platformCode ? { platform: { code: platformCode } } : {}),
      },
      include: { platform: true },
    });
  }

  /** 管理员未指定 userId 时，汇总全公司员工渠道 */
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

  private async loadAccountsForOwners(ownerIds: number[], platformCode?: string) {
    if (!ownerIds.length) return [];
    return this.prisma.channelAccount.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        ...(platformCode ? { platform: { code: platformCode } } : {}),
      },
      include: { platform: true },
    });
  }

  /** 校验平台 code，避免 endsWith 误匹配短码 */
  private async assertValidPlatformCode(platformCode?: string) {
    if (!platformCode) return;
    const row = await this.prisma.platform.findFirst({
      where: { code: platformCode, isEnabled: true },
      select: { code: true },
    });
    if (!row) throw new BadRequestException(`未知平台: ${platformCode}`);
  }

  private async aggregateMerchants(
    accountIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<MerchantCommissionAgg[]> {
    if (!accountIds.length) return [];

    const orderDate = buildOrderDateRangeFilter(startDate, endDate);
    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        ...(orderDate ? { orderDate } : {}),
        merchantId: { not: null },
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    return aggregateAffiliateOrders(orders);
  }

  private evaluateMerchants(merchants: MerchantCommissionAgg[], monitorRule: ReturnType<typeof ruleFromDb>) {
    const watchlist: Array<
      MerchantCommissionAgg & {
        severity: string;
        reasons: string[];
        alertMerchantKey: string;
      }
    > = [];
    const atRiskKeys = new Set<string>();

    for (const m of merchants) {
      const ev = evaluateCommissionRisk(m, monitorRule);
      if (ev.hit) {
        const alertMerchantKey = commissionAlertMerchantId(
          m.merchantId,
          m.platformCode,
          m.affiliateAlias,
        );
        atRiskKeys.add(alertMerchantKey);
        watchlist.push({
          ...m,
          severity: ev.severity,
          reasons: ev.reasons,
          alertMerchantKey,
        });
      }
    }

    watchlist.sort(
      (a, b) =>
        b.rejectedCommission - a.rejectedCommission || b.rejectionRate - a.rejectionRate,
    );

    return { watchlist, atRiskKeys };
  }

  private sumMerchants(merchants: MerchantCommissionAgg[]) {
    return merchants.reduce(
      (acc, m) => {
        acc.totalOrders += m.orderCount;
        acc.totalCommission += m.totalCommission;
        acc.rejectedCommission += m.rejectedCommission;
        acc.pendingCommission += m.pendingCommission;
        acc.confirmedCommission += m.confirmedCommission;
        return acc;
      },
      {
        totalOrders: 0,
        totalCommission: 0,
        rejectedCommission: 0,
        pendingCommission: 0,
        confirmedCommission: 0,
      },
    );
  }

  /**
   * 监控概览：全平台汇总 + 分平台指标 + 风险商家
   * 管理员未指定 userId 时使用全公司员工数据，告警规则取管理员配置
   */
  async getOverview(
    user: AuthUser,
    startDate: string,
    endDate: string,
    platformCode?: string,
    queryUserId?: number,
  ) {
    await this.assertValidPlatformCode(platformCode);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    const ruleUserId = isCompanyWideScope(user, queryUserId) ? user.id : ownerIds[0];
    const rule = await this.getOrCreateRule(ruleUserId);
    const monitorRule = ruleFromDb(rule);
    const accounts = await this.loadAccountsForOwners(ownerIds, platformCode);
    const allAccountIds = accounts.map((a) => a.id);
    await renormalizeOrdersForAccounts(this.prisma, allAccountIds);

    const windowStart = this.parseWindowDate(startDate);
    const windowEnd = this.parseWindowDate(endDate);

    type WatchRow = ReturnType<AlertsService['evaluateMerchants']>['watchlist'][number] & {
      userId?: number;
      username?: string;
    };

    let watchlist: WatchRow[] = [];
    let atRiskKeys = new Set<string>();
    let combinedMerchants: MerchantCommissionAgg[] = [];
    let employeeSummaries:
      | Array<{
          userId: number;
          username: string;
          rejectedCommission: number;
          rejectionRate: number;
          atRiskMerchantCount: number;
          openAlertCount: number;
        }>
      | undefined;

    const companyWide = isCompanyWideScope(user, queryUserId) && ownerIds.length > 1;

    if (companyWide) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, username: true },
      });
      const nameById = new Map(users.map((u) => [u.id, u.username]));
      employeeSummaries = [];

      for (const empId of ownerIds) {
        const empAccountIds = accounts
          .filter((a) => a.ownerUserId === empId)
          .map((a) => a.id);
        if (!empAccountIds.length) {
          employeeSummaries.push({
            userId: empId,
            username: nameById.get(empId) ?? `#${empId}`,
            rejectedCommission: 0,
            rejectionRate: 0,
            atRiskMerchantCount: 0,
            openAlertCount: 0,
          });
          continue;
        }

        const empMerchants = await this.aggregateMerchants(empAccountIds, startDate, endDate);
        const scopedEmp = platformCode
          ? empMerchants.filter((m) => m.platformCode === platformCode)
          : empMerchants;
        combinedMerchants.push(...scopedEmp);
        const { watchlist: empWatch, atRiskKeys: empKeys } = this.evaluateMerchants(
          scopedEmp,
          monitorRule,
        );
        const empTotals = this.sumMerchants(scopedEmp);
        const empRejectionRate =
          empTotals.totalCommission > 0
            ? (empTotals.rejectedCommission / empTotals.totalCommission) * 100
            : 0;

        const openAlertCount = await this.prisma.commissionAlert.count({
          where: {
            userId: empId,
            status: CommissionAlertStatus.open,
            windowStart,
            windowEnd,
            ...(platformCode ? platformCommissionAlertFilter(platformCode) : {}),
          },
        });

        employeeSummaries.push({
          userId: empId,
          username: nameById.get(empId) ?? `#${empId}`,
          rejectedCommission: Math.round(empTotals.rejectedCommission * 100) / 100,
          rejectionRate: Math.round(empRejectionRate * 10) / 10,
          atRiskMerchantCount: empWatch.length,
          openAlertCount,
        });

        for (const w of empWatch) {
          watchlist.push({
            ...w,
            userId: empId,
            username: nameById.get(empId) ?? `#${empId}`,
          });
        }
        for (const k of empKeys) atRiskKeys.add(k);
      }

      watchlist.sort(
        (a, b) =>
          b.rejectedCommission - a.rejectedCommission || b.rejectionRate - a.rejectionRate,
      );
      employeeSummaries.sort(
        (a, b) =>
          b.atRiskMerchantCount - a.atRiskMerchantCount ||
          b.rejectedCommission - a.rejectedCommission,
      );
    } else {
      const allMerchants = await this.aggregateMerchants(allAccountIds, startDate, endDate);
      combinedMerchants = allMerchants;
      const evaluated = this.evaluateMerchants(allMerchants, monitorRule);
      atRiskKeys = evaluated.atRiskKeys;
      watchlist = platformCode
        ? evaluated.watchlist.filter((w) => w.platformCode === platformCode)
        : evaluated.watchlist;
    }

    const platformSummaries = mergePlatformCatalog(
      summarizeMerchantsByPlatform(combinedMerchants, atRiskKeys),
      accounts.map((a) => ({
        affiliateAlias: a.affiliateAlias,
        displayName: a.displayName,
        platform: a.platform,
      })),
    );

    const scopedMerchants = platformCode
      ? combinedMerchants.filter((m) => m.platformCode === platformCode)
      : combinedMerchants;

    const totals = this.sumMerchants(scopedMerchants);
    const overallRejectionRate =
      totals.totalCommission > 0
        ? (totals.rejectedCommission / totals.totalCommission) * 100
        : 0;

    const alertWhere = {
      userId: ownerIds.length === 1 ? ownerIds[0] : { in: ownerIds },
      windowStart,
      windowEnd,
      ...(platformCode ? platformCommissionAlertFilter(platformCode) : {}),
    };

    const [openAlerts, ackCount] = await Promise.all([
      this.prisma.commissionAlert.count({
        where: { ...alertWhere, status: CommissionAlertStatus.open },
      }),
      this.prisma.commissionAlert.count({
        where: { ...alertWhere, status: CommissionAlertStatus.ack },
      }),
    ]);

    return {
      window: { startDate, endDate },
      platformFilter: platformCode ?? null,
      rule: {
        isEnabled: rule.isEnabled,
        rejectedAmountThreshold: monitorRule.rejectedAmountThreshold,
        rejectedRateThreshold: monitorRule.rejectedRateThreshold,
        minRejectedOrders: monitorRule.minRejectedOrders,
        minOrdersForRate: monitorRule.minOrdersForRate,
        minRejectedForRate: monitorRule.minRejectedForRate,
        autoCheckOnSync: rule.autoCheckOnSync,
      },
      summary: {
        totalOrders: totals.totalOrders,
        totalCommission: Math.round(totals.totalCommission * 100) / 100,
        confirmedCommission: Math.round(totals.confirmedCommission * 100) / 100,
        pendingCommission: Math.round(totals.pendingCommission * 100) / 100,
        rejectedCommission: Math.round(totals.rejectedCommission * 100) / 100,
        overallRejectionRate: Math.round(overallRejectionRate * 10) / 10,
        atRiskMerchantCount: watchlist.length,
        openAlertCount: openAlerts,
        ackAlertCount: ackCount,
      },
      platformSummaries,
      watchlist,
      employeeSummaries,
      scope: isCompanyWideScope(user, queryUserId) ? 'company' : 'user',
      selectedUserId: queryUserId ?? null,
    };
  }

  /**
   * 按规则检查佣金风险；管理员默认对全员执行，并使用管理员告警规则
   */
  async runCheckForScope(
    user: AuthUser,
    override?: { startDate?: string; endDate?: string; platformCode?: string },
    queryUserId?: number,
  ) {
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    if (ownerIds.length === 1) {
      const ruleUserId = isAdmin(user) ? user.id : ownerIds[0];
      return this.runCheck(ownerIds[0], override, ruleUserId);
    }

    const rule = await this.getOrCreateRule(user.id);
    if (!rule.isEnabled) {
      return { triggered: 0, alerts: [], window: null, message: '告警已关闭，请先启用' };
    }

    let triggered = 0;
    const alerts: unknown[] = [];
    let window: { startDate: string; endDate: string } | null = null;
    for (const empId of ownerIds) {
      const result = await this.runCheck(empId, override, user.id);
      triggered += result.triggered;
      alerts.push(...result.alerts);
      if (result.window) window = result.window;
    }

    return {
      triggered,
      alerts,
      window,
      message:
        triggered > 0
          ? `全公司 ${ownerIds.length} 名员工，共触发 ${triggered} 条告警`
          : window
            ? `全公司 ${ownerIds.length} 名员工，在 ${window.startDate} ~ ${window.endDate} 内无达阈值商家`
            : '无渠道账号',
    };
  }

  async runCheck(
    userId: number,
    override?: { startDate?: string; endDate?: string; platformCode?: string },
    ruleUserId?: number,
  ) {
    await this.assertValidPlatformCode(override?.platformCode);
    const rule = await this.getOrCreateRule(ruleUserId ?? userId);
    if (!rule.isEnabled) {
      return { triggered: 0, alerts: [], window: null, message: '告警已关闭，请先启用' };
    }

    const win =
      override?.startDate && override?.endDate
        ? { startDate: override.startDate, endDate: override.endDate }
        : this.computeWindow(rule.windowDays);
    const windowStart = this.parseWindowDate(win.startDate);
    const windowEnd = this.parseWindowDate(win.endDate);
    const monitorRule = ruleFromDb(rule);

    const accounts = await this.loadUserAccounts(userId, override?.platformCode);
    const accountIds = accounts.map((a) => a.id);
    if (!accountIds.length) {
      return { triggered: 0, alerts: [], window: win, message: '无渠道账号' };
    }

    await renormalizeOrdersForAccounts(this.prisma, accountIds);
    const merchants = await this.aggregateMerchants(accountIds, win.startDate, win.endDate);

    await this.prisma.commissionAlert.updateMany({
      where: {
        userId,
        status: CommissionAlertStatus.open,
        windowStart,
        windowEnd,
        ...(override?.platformCode
          ? platformCommissionAlertFilter(override.platformCode)
          : {}),
      },
      data: { status: CommissionAlertStatus.superseded },
    });

    const triggered: unknown[] = [];

    for (const row of merchants) {
      const ev = evaluateCommissionRisk(row, monitorRule);
      if (!ev.hit) continue;

      const alertMerchantKey = commissionAlertMerchantId(
        row.merchantId,
        row.platformCode,
        row.affiliateAlias,
      );
      const displayName = row.merchantName
        ? `${row.merchantName} (${row.platformName})`
        : row.platformName;

      const alert = await this.prisma.commissionAlert.upsert({
        where: {
          userId_merchantId_windowStart_windowEnd: {
            userId,
            merchantId: alertMerchantKey,
            windowStart,
            windowEnd,
          },
        },
        create: {
          userId,
          merchantId: alertMerchantKey,
          merchantName: displayName,
          windowStart,
          windowEnd,
          totalCommission: row.totalCommission,
          rejectedCommission: row.rejectedCommission,
          pendingCommission: row.pendingCommission,
          rejectedOrderCount: row.rejectedOrderCount,
          totalOrderCount: row.orderCount,
          rejectionRate: row.rejectionRate,
          thresholdAmount: monitorRule.rejectedAmountThreshold,
          thresholdRate: monitorRule.rejectedRateThreshold,
          triggerReason: ev.reasons.join('；'),
          severity: ev.severity,
          status: CommissionAlertStatus.open,
        },
        update: {
          merchantName: displayName,
          totalCommission: row.totalCommission,
          rejectedCommission: row.rejectedCommission,
          pendingCommission: row.pendingCommission,
          rejectedOrderCount: row.rejectedOrderCount,
          totalOrderCount: row.orderCount,
          rejectionRate: row.rejectionRate,
          triggerReason: ev.reasons.join('；'),
          severity: ev.severity,
          status: CommissionAlertStatus.open,
          lastTriggeredAt: new Date(),
        },
      });
      triggered.push(alert);
    }

    const amountTh = monitorRule.rejectedAmountThreshold;
    const rateTh = monitorRule.rejectedRateThreshold;

    return {
      triggered: triggered.length,
      alerts: triggered,
      window: win,
      message:
        triggered.length > 0
          ? `在 ${win.startDate} ~ ${win.endDate} 内触发 ${triggered.length} 条告警`
          : `在 ${win.startDate} ~ ${win.endDate} 内无商家达到阈值（失效佣金≥$${amountTh} 或 失效率≥${rateTh}%）`,
    };
  }

  /** 采集完成后按任务区间自动检查（若规则启用） */
  async runCheckAfterSync(
    userId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ triggered: number } | null> {
    const rule = await this.getOrCreateRule(userId);
    if (!rule.isEnabled || !rule.autoCheckOnSync) return null;
    const result = await this.runCheck(userId, { startDate, endDate });
    return { triggered: result.triggered };
  }

  async listAlerts(
    user: AuthUser,
    opts: {
      userId?: number;
      status?: string;
      limit?: number;
      startDate?: string;
      endDate?: string;
      platformCode?: string;
    },
  ) {
    await this.assertValidPlatformCode(opts.platformCode);
    const ownerIds = await this.resolveOwnerUserIds(user, opts.userId);
    const windowStart = opts.startDate ? this.parseWindowDate(opts.startDate) : undefined;
    const windowEnd = opts.endDate ? this.parseWindowDate(opts.endDate) : undefined;

    const statusFilter =
      opts.status && opts.status !== 'all'
        ? { status: opts.status as CommissionAlertStatus }
        : opts.status === 'all'
          ? {}
          : { status: CommissionAlertStatus.open };

    return this.prisma.commissionAlert
      .findMany({
        where: {
          userId: ownerIds.length === 1 ? ownerIds[0] : { in: ownerIds },
          ...statusFilter,
          ...(windowStart && windowEnd ? { windowStart, windowEnd } : {}),
          ...(opts.platformCode ? platformCommissionAlertFilter(opts.platformCode) : {}),
        },
        include: { user: { select: { id: true, username: true } } },
        orderBy: [{ status: 'asc' }, { lastTriggeredAt: 'desc' }],
        take: opts.limit ?? 100,
      })
      .then((rows) =>
        rows.map(({ user, ...r }) => ({
          ...r,
          username: user.username,
          ownerUserId: r.userId,
        })),
      );
  }

  async ackAlert(user: AuthUser, alertId: number) {
    const alert = await this.prisma.commissionAlert.findUnique({ where: { id: alertId } });
    if (!alert) throw new Error('告警不存在');
    if (alert.userId !== user.id && !isAdmin(user)) throw new Error('无权操作');
    return this.prisma.commissionAlert.update({
      where: { id: alertId },
      data: { status: CommissionAlertStatus.ack },
    });
  }

  async companyAlertSummary() {
    const open = await this.prisma.commissionAlert.findMany({
      where: { status: CommissionAlertStatus.open },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { rejectedCommission: 'desc' },
    });
    const totalRejected = open.reduce((s, a) => s + Number(a.rejectedCommission), 0);
    return {
      openCount: open.length,
      totalRejectedCommission: totalRejected,
      items: open,
    };
  }
}
