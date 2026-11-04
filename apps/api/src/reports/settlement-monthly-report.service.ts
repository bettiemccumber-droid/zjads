import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { resolveOrderCommissionBuckets } from '../common/order-commission-buckets.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { AuthUser, isCompanyWideScope, resolveOwnerUserId } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementActualCommissionService } from './settlement-actual-commission.service';
import { sortSettlementColumns } from './settlement-column-order.util';
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
  scope: 'company' | 'user';
  selectedUserId: number | null;
  adSpendRows: SettlementMonthlyAdSpendRow[];
  adSpendTotalUsd: number;
  /** 当月有花费的去重 campaign 数 */
  activeCampaignCount: number;
  columns: SettlementMonthlyColumn[];
  matrixRows: SettlementMonthlyMatrixRow[];
  distributableProfitBookUsd: number;
  distributableProfitBookCny: number;
  actualCommissionTotalUsd: number;
  canEditActualCommission: boolean;
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
  ) {}

  async build(user: AuthUser, month: string, queryUserId?: number): Promise<SettlementMonthlyReport> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('month 须为 YYYY-MM');
    }
    const { startDate, endDate } = monthToDateRange(month);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    const rate = this.resolveUsdCnyRate();

    const scopeKey = resolveSettlementReportScopeKey(user, queryUserId);
    const actualHalves = await this.actualCommission.loadHalvesForMonth(scopeKey, month);

    const adSpendRows = await this.buildAdSpendRows(ownerIds, startDate, endDate);
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
      '广告费按各员工「广告数据源」名称（MCC）汇总 Sheet 导入的 campaign 日花费。',
    ];

    return {
      month,
      startDate,
      endDate,
      usdCnyRate: rate,
      rateNote: `1 USD = ${rate} CNY（${month}，SETTLEMENT_USD_CNY_RATE）`,
      scope: isCompanyWideScope(user, queryUserId) ? 'company' : 'user',
      selectedUserId: queryUserId ?? null,
      adSpendRows,
      adSpendTotalUsd,
      activeCampaignCount,
      columns,
      matrixRows,
      distributableProfitBookUsd: roundMoney(bookTotal - adSpendTotalUsd),
      distributableProfitBookCny: roundMoney((bookTotal - adSpendTotalUsd) * rate),
      actualCommissionTotalUsd: actualTotal,
      canEditActualCommission: canEditSettlementActualCommission(user, queryUserId),
      notes,
    };
  }

  async buildYearly(user: AuthUser, year: string, queryUserId?: number): Promise<SettlementYearlyReport> {
    if (!/^\d{4}$/.test(year)) {
      throw new BadRequestException('year 须为 YYYY');
    }
    const { startDate, endDate } = yearToDateRange(year);
    const ownerIds = await this.resolveOwnerUserIds(user, queryUserId);
    const rate = this.resolveUsdCnyRate();

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
      rateNote: `1 USD = ${rate} CNY（环境变量 SETTLEMENT_USD_CNY_RATE，非实时）`,
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

  private resolveUsdCnyRate(): number {
    const raw = process.env.SETTLEMENT_USD_CNY_RATE;
    const n = raw ? Number(raw) : 7.25;
    return Number.isFinite(n) && n > 0 ? n : 7.25;
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

    for (const src of sources) {
      const agg = await this.prisma.adCampaignDaily.aggregate({
        where: {
          ownerUserId: src.ownerUserId,
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        _sum: { cost: true },
      });
      const spendUsd = roundMoney(Number(agg._sum.cost ?? 0));
      rows.push({
        mccLabel: src.name.trim() || `Sheet#${src.id}`,
        currency: 'USD',
        librarySpendUsd: spendUsd,
        adjustmentUsd: 0,
        spendUsd,
        ownerUserId: src.ownerUserId,
        adSourceId: src.id,
      });
    }

    return rows;
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

    const aliasMeta = new Map<
      string,
      {
        affiliateAlias: string;
        platformCode: string;
        platformName: string;
        accountIds: number[];
        accountNames: string[];
      }
    >();

    for (const a of accounts) {
      const alias = (a.affiliateAlias || 'default').toLowerCase();
      const key = alias;
      if (!aliasMeta.has(key)) {
        aliasMeta.set(key, {
          affiliateAlias: alias,
          platformCode: a.platform.code,
          platformName: a.platform.name,
          accountIds: [],
          accountNames: [],
        });
      }
      const meta = aliasMeta.get(key)!;
      meta.accountIds.push(a.id);
      const name = a.displayName?.trim() || a.externalChannelId || `#${a.id}`;
      if (!meta.accountNames.includes(name)) {
        meta.accountNames.push(name);
      }
    }

    const columns: SettlementMonthlyColumn[] = sortSettlementColumns(
      [...aliasMeta.entries()].map(([key, meta]) => ({
        key,
        label: meta.affiliateAlias.toUpperCase() || meta.platformCode.toUpperCase(),
        affiliateAlias: meta.affiliateAlias,
        platformCode: meta.platformCode,
        platformName: meta.platformName,
        accountHint: meta.accountNames.join(' / '),
      })),
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

    const accountToAlias = new Map(accounts.map((a) => [a.id, (a.affiliateAlias || 'default').toLowerCase()]));

    type Bucket = {
      book: number;
      rejected: number;
      recvH1: number;
      recvH2: number;
    };
    const byAlias = new Map<string, Bucket>();
    const ensure = (alias: string) => {
      if (!byAlias.has(alias)) {
        byAlias.set(alias, { book: 0, rejected: 0, recvH1: 0, recvH2: 0 });
      }
      return byAlias.get(alias)!;
    };

    for (const o of orders) {
      const alias = accountToAlias.get(o.channelAccountId) ?? 'default';
      const b = ensure(alias);
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
        out[col.key] = roundMoney(pick(byAlias.get(col.key) ?? { book: 0, rejected: 0, recvH1: 0, recvH2: 0 }));
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

    const emptyText = Object.fromEntries(columns.map((c) => [c.key, '']));

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
        textValues: emptyText,
        totalUsd: 0,
      },
      {
        rowKey: 'bank',
        label: '收款卡号',
        rowType: 'text',
        values: {},
        textValues: emptyText,
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
