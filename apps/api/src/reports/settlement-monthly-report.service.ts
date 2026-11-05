import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { resolveOrderCommissionBuckets } from '../common/order-commission-buckets.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { SettlementAdSpendService } from './settlement-ad-spend.service';
import { SettlementUsdCnyRateService } from './settlement-usd-cny-rate.service';
import { parseLinkedCustomerIds } from '../ad-sources/linked-customer-ids.util';
import {
  settlementColumnDisplayLabel,
  sortSettlementColumns,
} from './settlement-column-order.util';
import { monthToDateRange, roundMoney, utcMonthKey, yearToDateRange } from './settlement-monthly.util';
import {
  canEditSettlementActualCommission,
  resolveSettlementReportScopeKey,
} from './settlement-report-scope.util';

export interface SettlementMonthlyAdSpendRow {
  mccLabel: string;
  currency: string;
  /** 库内广告费（Sheet 汇总） */
  librarySpendUsd: number;
  /** 补充金额 */
  adjustmentUsd: number;
  spendUsd: number;
  ownerUserId: number;
  adSourceId: number;
  /** 多 MCC 未绑子账号且本行未分到花费（需重新导入 Sheet） */
  splitBindingPending?: boolean;
}

export interface SettlementMonthlyColumn {
  key: string;
  label: string;
  affiliateAlias: string;
  platformCode: string;
  platformName: string;
  /** 账号名称行（平台账号 displayName） */
  accountHint: string;
}

export interface SettlementMonthlyMatrixRow {
  rowKey: string;
  label: string;
  rowType: 'money' | 'text';
  values: Record<string, number>;
  textValues?: Record<string, string>;
  totalUsd: number;
}

export interface SettlementMonthlyReport {
  month: string;
  startDate: string;
  endDate: string;
  usdCnyRate: number;
  rateNote: string;
  /** 是否为外部实时汇率（false 表示环境变量兜底） */
  usdCnyRateLive: boolean;
  scope: 'company' | 'user';
  selectedUserId: number | null;
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  /** 应返广告费 (USD) */
  rebateAdSpendUsd: number;
  /** 当月有花费的去重 campaign 数 */
  activeCampaignCount: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
  actualCommissionTotalUsd: number;
  canEditActualCommission: boolean;
  canEditAdSpend: boolean;
  canEditPayoutInfo: boolean;
  /** 存在多 MCC 未绑 Google 子账号，广告费临时合并到首个 MCC */
  adSpendSplitPending: boolean;
  notes: string[];
}

export interface SettlementYearlyMonthRow {
  month: string;
  adSpendUsd: number;
  bookCommissionUsd: number;
  rejectedCommissionUsd: number;
  receivableCommissionUsd: number;
  distributableProfitUsd: number;
}

export interface SettlementYearlyReport {
  year: string;
  startDate: string;
  endDate: string;
  usdCnyRate: number;
  rateNote: string;
  usdCnyRateLive: boolean;
  scope: 'company' | 'user';
  selectedUserId: number | null;
  monthlyRows: SettlementYearlyMonthRow[];
  yearTotal: SettlementYearlyMonthRow;
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
  actualCommissionTotalUsd: number;
  canEditActualCommission: boolean;
  notes: string[];
}

@Injectable()
export class SettlementMonthlyReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actualCommission: SettlementActualCommissionService,
    private readonly adSpend: SettlementAdSpendService,
    private readonly usdCnyRateService: SettlementUsdCnyRateService,
  ) {}

  async build(
    user: AuthUser,
    month: string,
    queryUserId?: number,
    refreshFx = false,
  ): Promise<SettlementMonthlyReport> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    const fx = await this.usdCnyRateService.getQuote(refreshFx);
    const rate = fx.rate;

    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    const actualHalves = await this.actualCommission.loadHalvesForMonth(scopeKey, month);

    const adSpendSaved = await this.adSpend.loadLinesForMonth(scopeKey, month);
    const adSpendMeta = await this.adSpend.loadMeta(scopeKey, month);
    let adSpendRows = await this.buildAdSpendRows(ownerIds, startDate, endDate);
    adSpendRows = this.mergeAdSpendSaved(adSpendRows, adSpendSaved);
    const adSpendSplitPending = adSpendRows.some((r) => r.splitBindingPending);
    const adSpendTotalUsd = roundMoney(adSpendRows.reduce((s, r) => s + r.spendUsd, 0));
    const activeCampaignCount = await this.countActiveCampaigns(ownerIds, startDate, endDate);

    const { columns, matrixRows } = await this.buildCommissionMatrix(
      ownerIds,
      startDate,
      endDate,
      actualHalves,
    );

    const bookRow = matrixRows.find((r) => r.rowKey === 'book');
    const bookTotal = bookRow?.totalUsd ?? 0;
    const actualRow = matrixRows.find((r) => r.rowKey === 'actual_total');
    const actualTotal = actualRow?.totalUsd ?? 0;

    const notes: string[] = [
      '账面/失效佣金按联盟订单 orderDate 汇总；拒付拆分与结算查询一致。',
      '应收按订单 confirmDate（无则 orderDate）落入上半月(1–15日)/下半月(16–月末)。',
      '实收佣金可手工录入并保存；与当前报表范围（全公司/员工）绑定。',
      '广告费按各 MCC 关联的 Google 子账号汇总；多 MCC 时请重新导入 Sheet 以刷新子账号绑定。',
      '佣金列按平台渠道账号拆分（同 alias 多账号显示 RW1/RW2 等）。',
      '补充金额与「广告费可改」可保存；未保存时广告费等于库内汇总。',
      'CNY 折算按页头实时 USD/CNY；点击「刷新」可强制更新汇率（默认缓存 5 分钟）。',
      '收款人/卡号按各渠道账号维护，可在「平台账号」或本页保存。',
      `本报表统计区间：${startDate} ~ ${endDate}（自然月）。与广告系列分析对比时请选相同日期与员工范围。`,
    ];
    if (adSpendSplitPending) {
      notes.unshift(
        '多个 MCC 尚未绑定 Google 子账号：库内广告费已临时汇总到该员工第一个 MCC 行；请对各 MCC 重新导入 Sheet 后刷新，以按 MCC 正确拆分。',
      );
    }

    const canEditAdSpend = canEditSettlementActualCommission(user, queryUserId);

    return {
      month,
      startDate,
      endDate,
      usdCnyRate: rate,
      rateNote: fx.rateNote,
      usdCnyRateLive: fx.isLive,
      scope: isCompanyWideScope(user, queryUserId) ? 'company' : 'user',
      selectedUserId: queryUserId ?? null,
      adSpendRows,
      adSpendTotalUsd,
      rebateAdSpendUsd: adSpendMeta.rebateAdSpendUsd,
      activeCampaignCount,
      columns,
      matrixRows,
      distributableProfitBookUsd: roundMoney(bookTotal - adSpendTotalUsd),
      distributableProfitBookCny: roundMoney((bookTotal - adSpendTotalUsd) * rate),
      actualCommissionTotalUsd: actualTotal,
      canEditActualCommission: canEditAdSpend,
      canEditAdSpend,
      canEditPayoutInfo: canEditAdSpend,
      adSpendSplitPending,
      notes,
    };
  }

  async buildYearly(
    user: AuthUser,
    year: string,
    queryUserId?: number,
    refreshFx = false,
  ): Promise<SettlementYearlyReport> {
    if (!/^\d{4}$/.test(year)) {
      throw new BadRequestException('year 须为 YYYY');
    }
    const { startDate, endDate } = yearToDateRange(year);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    const fx = await this.usdCnyRateService.getQuote(refreshFx);
    const rate = fx.rate;

    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    const actualYearByKey = await this.actualCommission.loadYearSum(scopeKey, year);
    const actualHalvesYear = Object.fromEntries(
      Object.entries(actualYearByKey).map(([k, total]) => [k, { usdH1: 0, usdH2: total }]),
    );

    const adSpendRows = await this.buildAdSpendRows(ownerIds, startDate, endDate);
    const adSpendTotalUsd = roundMoney(adSpendRows.reduce((s, r) => s + r.spendUsd, 0));
    const { columns, matrixRows } = await this.buildCommissionMatrix(
      ownerIds,
      startDate,
      endDate,
      actualHalvesYear,
    );

    const monthlyRows = await this.buildYearlyMonthlyRows(ownerIds, year, startDate, endDate);
    const yearTotal = this.sumYearlyMonthRows(monthlyRows);

    const bookRow = matrixRows.find((r) => r.rowKey === 'book');
    const bookTotal = bookRow?.totalUsd ?? 0;
    const actualRow = matrixRows.find((r) => r.rowKey === 'actual_total');
    const actualTotal = actualRow?.totalUsd ?? 0;

    const notes: string[] = [
      '月度行：账面/失效按 orderDate 所在月；应收按 confirmDate（无则 orderDate）所在月汇总。',
      '年度合计与下方佣金矩阵为整年口径，与月度行之和一致。',
      '实收佣金为各月已保存实收之和；请在月度报表中录入。',
    ];

    return {
      year,
      startDate,
      endDate,
      usdCnyRate: rate,
      rateNote: fx.rateNote,
      usdCnyRateLive: fx.isLive,
      scope: isCompanyWideScope(user, queryUserId) ? 'company' : 'user',
      selectedUserId: queryUserId ?? null,
      monthlyRows,
      yearTotal,
      adSpendRows,
      adSpendTotalUsd,
      columns,
      matrixRows,
      distributableProfitBookUsd: roundMoney(bookTotal - adSpendTotalUsd),
      distributableProfitBookCny: roundMoney((bookTotal - adSpendTotalUsd) * rate),
      actualCommissionTotalUsd: actualTotal,
      canEditActualCommission: false,
      notes,
    };
  }

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

  private async buildAdSpendRows(
    ownerIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<SettlementMonthlyAdSpendRow[]> {
    if (!ownerIds.length) return [];

    const sources = await this.prisma.adDataSource.findMany({
      where: { ownerUserId: { in: ownerIds }, isActive: true },
      orderBy: [{ ownerUserId: 'asc' }, { name: 'asc' }],
    });

    const dateFilter = buildOrderDateRangeFilter(startDate, endDate);
    const rows: SettlementMonthlyAdSpendRow[] = [];
    const sourcesByOwner = new Map<number, typeof sources>();
    for (const src of sources) {
      const list = sourcesByOwner.get(src.ownerUserId) ?? [];
      list.push(src);
      sourcesByOwner.set(src.ownerUserId, list);
    }

    for (const src of sources) {
      const ownerSources = sourcesByOwner.get(src.ownerUserId) ?? [src];
      const ownerSourceCount = ownerSources.length;
      let customerIds = parseLinkedCustomerIds(src.linkedCustomerIds);
      let splitBindingPending = false;

      if (!customerIds.length) {
        if (ownerSourceCount === 1) {
          customerIds = [];
        } else {
          const allUnlinked = ownerSources.every(
            (s) => !parseLinkedCustomerIds(s.linkedCustomerIds).length,
          );
          const assignedElsewhere = this.collectAssignedCustomerIds(ownerSources, src.id);
          if (allUnlinked) {
            const firstId = ownerSources[0]?.id;
            if (firstId !== src.id) {
              rows.push(this.emptyAdSpendRow(src, true));
              continue;
            }
            customerIds = [];
          } else {
            customerIds = await this.listUnassignedCustomerIds(
              src.ownerUserId,
              assignedElsewhere,
              startDate,
              endDate,
            );
            if (!customerIds.length) {
              rows.push(this.emptyAdSpendRow(src, true));
              continue;
            }
          }
        }
      }

      if (
        ownerSourceCount > 1 &&
        !parseLinkedCustomerIds(src.linkedCustomerIds).length &&
        ownerSources.every((s) => !parseLinkedCustomerIds(s.linkedCustomerIds).length) &&
        ownerSources[0]?.id === src.id
      ) {
        splitBindingPending = true;
      }

      const where = {
        ownerUserId: src.ownerUserId,
        ...(dateFilter ? { date: dateFilter } : {}),
        ...(customerIds.length ? { customerId: { in: customerIds } } : {}),
      };

      const agg = await this.prisma.adCampaignDaily.aggregate({
        where,
        _sum: { cost: true },
      });
      const sample = await this.prisma.adCampaignDaily.findFirst({
        where,
        select: { currency: true },
        orderBy: { date: 'desc' },
      });
      const spendUsd = roundMoney(Number(agg._sum.cost ?? 0));
      const currency = (sample?.currency || 'USD').toUpperCase();
      rows.push({
        mccLabel: src.name.trim() || `Sheet#${src.id}`,
        currency,
        librarySpendUsd: spendUsd,
        adjustmentUsd: 0,
        spendUsd,
        ownerUserId: src.ownerUserId,
        adSourceId: src.id,
        splitBindingPending,
      });
    }

    return rows;
  }

  private emptyAdSpendRow(
    src: { id: number; name: string; ownerUserId: number },
    splitBindingPending: boolean,
  ): SettlementMonthlyAdSpendRow {
    return {
      mccLabel: src.name.trim() || `Sheet#${src.id}`,
      currency: 'USD',
      librarySpendUsd: 0,
      adjustmentUsd: 0,
      spendUsd: 0,
      ownerUserId: src.ownerUserId,
      adSourceId: src.id,
      splitBindingPending,
    };
  }

  private collectAssignedCustomerIds(
    ownerSources: Array<{ id: number; linkedCustomerIds: unknown }>,
    excludeSourceId: number,
  ): Set<string> {
    const out = new Set<string>();
    for (const s of ownerSources) {
      if (s.id === excludeSourceId) continue;
      for (const id of parseLinkedCustomerIds(s.linkedCustomerIds)) {
        out.add(id);
      }
    }
    return out;
  }

  /**
   * 某员工在区间内仍有花费、且未被其它 MCC 绑定的 Google customerId
   */
  private async listUnassignedCustomerIds(
    ownerUserId: number,
    assigned: Set<string>,
    startDate: string,
    endDate: string,
  ): Promise<string[]> {
    const dateFilter = buildOrderDateRangeFilter(startDate, endDate);
    const rows = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId,
        ...(dateFilter ? { date: dateFilter } : {}),
        cost: { gt: 0 },
      },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    return rows
      .map((r) => r.customerId?.trim())
      .filter((id): id is string => !!id && !assigned.has(id));
  }

  /**
   * 合并已保存的补充/可改广告费
   */
  private mergeAdSpendSaved(
    rows: SettlementMonthlyAdSpendRow[],
    saved: Record<number, { adjustmentUsd: number; spendUsd: number }>,
  ): SettlementMonthlyAdSpendRow[] {
    return rows.map((r) => {
      const hit = saved[r.adSourceId];
      if (!hit) {
        return {
          ...r,
          adjustmentUsd: 0,
          spendUsd: r.librarySpendUsd,
        };
      }
      return {
        ...r,
        adjustmentUsd: hit.adjustmentUsd,
        spendUsd: hit.spendUsd,
      };
    });
  }

  private async buildYearlyMonthlyRows(
    ownerIds: number[],
    year: string,
    startDate: string,
    endDate: string,
  ): Promise<SettlementYearlyMonthRow[]> {
    const monthKeys = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, '0');
      return `${year}-${mm}`;
    });
    const emptyBucket = () =>
      Object.fromEntries(monthKeys.map((k) => [k, 0])) as Record<string, number>;

    const adByMonth = emptyBucket();
    const bookByMonth = emptyBucket();
    const rejectedByMonth = emptyBucket();
    const recvByMonth = emptyBucket();

    if (ownerIds.length) {
      const dateFilter = buildOrderDateRangeFilter(startDate, endDate);
      const adDaily = await this.prisma.adCampaignDaily.findMany({
        where: {
          ownerUserId: { in: ownerIds },
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        select: { date: true, cost: true },
      });
      for (const row of adDaily) {
        const key = utcMonthKey(row.date);
        if (key.startsWith(`${year}-`)) {
          adByMonth[key] = (adByMonth[key] ?? 0) + Number(row.cost);
        }
      }

      const accounts = await this.prisma.channelAccount.findMany({
        where: { ownerUserId: { in: ownerIds }, isActive: true },
        select: { id: true },
      });
      const accountIds = accounts.map((a) => a.id);
      if (accountIds.length) {
        const orderDate = buildOrderDateRangeFilter(startDate, endDate);
        const orders = await this.prisma.affiliateOrder.findMany({
          where: {
            channelAccountId: { in: accountIds },
            ...(orderDate ? { orderDate } : {}),
          },
          select: {
            commission: true,
            orderDate: true,
            confirmDate: true,
            normalizedStatus: true,
            rawPayload: true,
          },
        });
        for (const o of orders) {
          const buckets = resolveOrderCommissionBuckets(o);
          const orderKey = utcMonthKey(o.orderDate);
          if (orderKey.startsWith(`${year}-`)) {
            bookByMonth[orderKey] = (bookByMonth[orderKey] ?? 0) + Number(o.commission);
            rejectedByMonth[orderKey] = (rejectedByMonth[orderKey] ?? 0) + buckets.rejected;
          }
          const bucketDate = o.confirmDate ?? o.orderDate;
          const recvKey = utcMonthKey(bucketDate);
          if (recvKey.startsWith(`${year}-`)) {
            recvByMonth[recvKey] =
              (recvByMonth[recvKey] ?? 0) + roundMoney(buckets.approved + buckets.pending);
          }
        }
      }
    }

    return monthKeys.map((month) => {
      const adSpendUsd = roundMoney(adByMonth[month] ?? 0);
      const bookCommissionUsd = roundMoney(bookByMonth[month] ?? 0);
      const rejectedCommissionUsd = roundMoney(rejectedByMonth[month] ?? 0);
      const receivableCommissionUsd = roundMoney(recvByMonth[month] ?? 0);
      return {
        month,
        adSpendUsd,
        bookCommissionUsd,
        rejectedCommissionUsd,
        receivableCommissionUsd,
        distributableProfitUsd: roundMoney(bookCommissionUsd - adSpendUsd),
      };
    });
  }

  private sumYearlyMonthRows(rows: SettlementYearlyMonthRow[]): SettlementYearlyMonthRow {
    const sum = (pick: (r: SettlementYearlyMonthRow) => number) =>
      roundMoney(rows.reduce((s, r) => s + pick(r), 0));
    return {
      month: 'total',
      adSpendUsd: sum((r) => r.adSpendUsd),
      bookCommissionUsd: sum((r) => r.bookCommissionUsd),
      rejectedCommissionUsd: sum((r) => r.rejectedCommissionUsd),
      receivableCommissionUsd: sum((r) => r.receivableCommissionUsd),
      distributableProfitUsd: sum((r) => r.distributableProfitUsd),
    };
  }

  private async countActiveCampaigns(
    ownerIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<number> {
    if (!ownerIds.length) return 0;
    const dateFilter = buildOrderDateRangeFilter(startDate, endDate);
    const rows = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId: { in: ownerIds },
        ...(dateFilter ? { date: dateFilter } : {}),
        cost: { gt: 0 },
      },
      select: { campaignId: true },
      distinct: ['campaignId'],
    });
    return rows.length;
  }

  private async buildCommissionMatrix(
    ownerIds: number[],
    startDate: string,
    endDate: string,
    actualHalves: Record<string, { usdH1: number; usdH2: number }> = {},
  ): Promise<{ columns: SettlementMonthlyColumn[]; matrixRows: SettlementMonthlyMatrixRow[] }> {
    const empty = { columns: [] as SettlementMonthlyColumn[], matrixRows: [] as SettlementMonthlyMatrixRow[] };
    if (!ownerIds.length) return empty;

    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: { in: ownerIds }, isActive: true },
      include: { platform: true },
    });
    if (!accounts.length) return empty;

    const aliasCounts = new Map<string, number>();
    for (const a of accounts) {
      const alias = (a.affiliateAlias || 'default').toLowerCase();
      aliasCounts.set(`${a.platform.code}|${alias}`, (aliasCounts.get(`${a.platform.code}|${alias}`) ?? 0) + 1);
    }
    const aliasSeen = new Map<string, number>();

    const columns: SettlementMonthlyColumn[] = sortSettlementColumns(
      accounts.map((a) => {
        const alias = (a.affiliateAlias || 'default').toLowerCase();
        const groupKey = `${a.platform.code}|${alias}`;
        const dupIndex = aliasSeen.get(groupKey) ?? 0;
        aliasSeen.set(groupKey, dupIndex + 1);
        const dupCount = aliasCounts.get(groupKey) ?? 1;
        const name = a.displayName?.trim() || a.externalChannelId || `#${a.id}`;
        return {
          key: String(a.id),
          label: settlementColumnDisplayLabel(alias, a.platform.code, dupIndex, dupCount),
          affiliateAlias: alias,
          platformCode: a.platform.code,
          platformName: a.platform.name,
          accountHint: name,
        };
      }),
    );

    const accountIds = accounts.map((a) => a.id);
    const orderDate = buildOrderDateRangeFilter(startDate, endDate);
    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        ...(orderDate ? { orderDate } : {}),
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    type Bucket = {
      book: number;
      rejected: number;
      recvH1: number;
      recvH2: number;
    };
    const byAccount = new Map<string, Bucket>();
    const ensure = (accountKey: string) => {
      if (!byAccount.has(accountKey)) {
        byAccount.set(accountKey, { book: 0, rejected: 0, recvH1: 0, recvH2: 0 });
      }
      return byAccount.get(accountKey)!;
    };

    for (const o of orders) {
      const accountKey = String(o.channelAccountId);
      const b = ensure(accountKey);
      const comm = Number(o.commission);
      const buckets = resolveOrderCommissionBuckets(o);
      b.book += comm;
      b.rejected += buckets.rejected;

      const recvAmount = roundMoney(buckets.approved + buckets.pending);
      const bucketDate = o.confirmDate ?? o.orderDate;
      const day = bucketDate.getUTCDate();
      if (day <= 15) b.recvH1 += recvAmount;
      else b.recvH2 += recvAmount;
    }

    const valuesFor = (pick: (b: Bucket) => number): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const col of columns) {
        out[col.key] = roundMoney(pick(byAccount.get(col.key) ?? { book: 0, rejected: 0, recvH1: 0, recvH2: 0 }));
      }
      return out;
    };

    const sumVals = (vals: Record<string, number>) =>
      roundMoney(Object.values(vals).reduce((s, v) => s + v, 0));

    const recvH1 = valuesFor((b) => b.recvH1);
    const recvH2 = valuesFor((b) => b.recvH2);
    const recvTotal: Record<string, number> = {};
    for (const col of columns) {
      recvTotal[col.key] = roundMoney((recvH1[col.key] ?? 0) + (recvH2[col.key] ?? 0));
    }

    const actualH1: Record<string, number> = {};
    const actualH2: Record<string, number> = {};
    for (const col of columns) {
      const half = actualHalves[col.key] ?? { usdH1: 0, usdH2: 0 };
      actualH1[col.key] = roundMoney(half.usdH1);
      actualH2[col.key] = roundMoney(half.usdH2);
    }
    const actualTotalVals: Record<string, number> = {};
    for (const col of columns) {
      actualTotalVals[col.key] = roundMoney((actualH1[col.key] ?? 0) + (actualH2[col.key] ?? 0));
    }

    const payeeText: Record<string, string> = {};
    const bankText: Record<string, string> = {};
    for (const a of accounts) {
      const key = String(a.id);
      payeeText[key] = (a.settlementPayeeName ?? '').trim();
      bankText[key] = (a.settlementBankAccount ?? '').trim();
    }

    const matrixRows: SettlementMonthlyMatrixRow[] = [
      {
        rowKey: 'book',
        label: '账面佣金(美金)',
        rowType: 'money',
        values: valuesFor((b) => b.book),
        totalUsd: 0,
      },
      {
        rowKey: 'rejected',
        label: '失效佣金(美金)',
        rowType: 'money',
        values: valuesFor((b) => b.rejected),
        totalUsd: 0,
      },
      {
        rowKey: 'recv_h1',
        label: '应收佣金·上半月(1–15日)',
        rowType: 'money',
        values: recvH1,
        totalUsd: 0,
      },
      {
        rowKey: 'recv_h2',
        label: '应收佣金·下半月(16–月末)',
        rowType: 'money',
        values: recvH2,
        totalUsd: 0,
      },
      {
        rowKey: 'recv_total',
        label: '应收佣金·合计',
        rowType: 'money',
        values: recvTotal,
        totalUsd: 0,
      },
      {
        rowKey: 'actual_h1',
        label: '实收佣金·上半月',
        rowType: 'money',
        values: actualH1,
        totalUsd: 0,
      },
      {
        rowKey: 'actual_h2',
        label: '实收佣金·下半月',
        rowType: 'money',
        values: actualH2,
        totalUsd: 0,
      },
      {
        rowKey: 'actual_total',
        label: '实收佣金·合计',
        rowType: 'money',
        values: actualTotalVals,
        totalUsd: 0,
      },
      {
        rowKey: 'payee',
        label: '收款人',
        rowType: 'text',
        values: {},
        textValues: payeeText,
        totalUsd: 0,
      },
      {
        rowKey: 'bank',
        label: '收款卡号',
        rowType: 'text',
        values: {},
        textValues: bankText,
        totalUsd: 0,
      },
    ];

    for (const row of matrixRows) {
      if (row.rowType === 'money') {
        row.totalUsd = sumVals(row.values);
      }
    }

    return { columns, matrixRows };
  }
}
