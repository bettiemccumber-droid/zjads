import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { dedupeAffiliateOrderRecord } from '../common/order-dedupe.util';
import { resolveOrderCommissionBuckets } from '../common/order-commission-buckets.util';
import {
  filterRowsByCampaignStatusMode,
  filterCampaignDailyByGroupStatus,
  resolveCampaignStatusMode,
} from '../common/campaign-status.util';
import {
  campaignAffiliateAttributionKey,
  campaignCoversMerchantAffiliate,
} from '../common/campaign-affiliate-attribution.util';
import { parseCampaignName, inferPlatformNameFromAlias } from '../common/campaign-name.util';
import { resolveCampaignGroupKey } from '../common/campaign-group.util';
import { suggestOperation } from '../common/operation-suggest.util';
import { AuthUser, resolveOwnerUserId } from '../common/ownership.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { formatCalendarDateUtc } from '../common/affiliate-order-date.util';
import { isLbClickPseudoMerchant } from '../collectors/linkbux-clicks';
import { isRwClickPseudoMerchant } from '../collectors/rewardoo-clicks';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../ad-sources/sheet-parser.util';
import { PrismaService } from '../prisma/prisma.service';

export interface ReportDateQuery {
  startDate: string;
  endDate: string;
  userId?: number;
  /** 广告系列报表：true = 只保留 ENABLED 系列（严格） */
  enabledOnly?: boolean;
  /** 广告系列报表：true = 隐藏无联盟订单的 PAUSED/REMOVED 系列（默认 true） */
  hideIdlePaused?: boolean;
  /** 广告系列状态：all | active | paused（优先于 enabledOnly / hideIdlePaused） */
  statusMode?: 'all' | 'active' | 'paused';
}

type AffiliateMetrics = {
  orderCount: number;
  commission: number;
  affiliateClicks: number;
};

type AffiliateMetricsIndex = {
  byKey: Map<string, AffiliateMetrics>;
  byMerchantId: Map<string, AffiliateMetrics>;
};

const EMPTY_AFFILIATE: AffiliateMetrics = {
  orderCount: 0,
  commission: 0,
  affiliateClicks: 0,
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 商家维度汇总（联盟订单 + Google Ads + 联盟点击监控）
   * 点击/转化率/CPC 仅来自 Google Ads；联盟点击单独展示用于刷量换链监控
   */
  async merchantSummary(user: AuthUser, q: ReportDateQuery) {
    const ownerId = resolveOwnerUserId(user, q.userId);
    const accountIds = (
      await this.prisma.channelAccount.findMany({
        where: { ownerUserId: ownerId },
        select: { id: true, affiliateAlias: true, platform: { select: { name: true, code: true } } },
      })
    ).map((a) => a.id);

    if (!accountIds.length) {
      return { summary: [], totals: this.emptyTotals() };
    }

    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        orderDate: this.orderDateRange(q.startDate, q.endDate),
      },
      include: {
        channelAccount: { include: { platform: true } },
      },
    });

    type Row = {
      merchantId: string;
      merchantName: string;
      affiliateAlias: string;
      platformName: string;
      campaignNames: string;
      orderCount: number;
      totalCommission: number;
      totalCost: number;
      totalClicks: number;
      affiliateClicks: number;
      totalImpressions: number;
      totalBudget: number;
    };

    const map = new Map<string, Row>();
    /** 按商家 + 去重订单号汇总，避免历史「按商品行入库」把订单数放大 */
    const orderAgg = new Map<
      string,
      {
        merchantKey: string;
        merchantId: string;
        merchantName: string;
        affiliateAlias: string;
        platformName: string;
        platformCode: string;
        commission: number;
      }
    >();

    for (const o of orders) {
      const alias = (o.channelAccount.affiliateAlias || '').toLowerCase();
      const merchantKey = `${o.merchantId ?? ''}|${alias}`;
      const orderKey = `${o.channelAccountId}|${dedupeAffiliateOrderRecord(o)}`;
      const comm = Number(o.commission);
      const existing = orderAgg.get(orderKey);
      if (existing) {
        existing.commission += comm;
      } else {
        orderAgg.set(orderKey, {
          merchantKey,
          merchantId: o.merchantId ?? '',
          merchantName: o.merchantName ?? '',
          affiliateAlias: alias,
          platformName: o.channelAccount.platform.name,
          platformCode: o.channelAccount.platform.code,
          commission: comm,
        });
      }
    }

    for (const agg of orderAgg.values()) {
      if (!map.has(agg.merchantKey)) {
        map.set(agg.merchantKey, {
          merchantId: agg.merchantId,
          merchantName: agg.merchantName,
          affiliateAlias: agg.affiliateAlias,
          platformName: agg.platformName,
          campaignNames: '',
          orderCount: 0,
          totalCommission: 0,
          totalCost: 0,
          totalClicks: 0,
          affiliateClicks: 0,
          totalImpressions: 0,
          totalBudget: 0,
        });
      }
      const row = map.get(agg.merchantKey)!;
      if (agg.platformCode === 'rewardoo') continue;
      row.orderCount += 1;
      row.totalCommission += agg.commission;
    }

    const adRows = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId: ownerId,
        date: buildOrderDateRangeFilter(q.startDate, q.endDate)!,
      },
    });

    for (const ad of adRows) {
      const parsed = parseCampaignName(ad.campaignName);
      const merchantId = ad.merchantId || parsed.merchantId;
      const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
      const key = this.resolveMerchantRowKey(map, merchantId, alias);
      if (!map.has(key)) {
        map.set(key, {
          merchantId,
          merchantName: '',
          affiliateAlias: alias,
          platformName: inferPlatformNameFromAlias(alias),
          campaignNames: ad.campaignName,
          orderCount: 0,
          totalCommission: 0,
          totalCost: 0,
          totalClicks: 0,
          affiliateClicks: 0,
          totalImpressions: 0,
          totalBudget: 0,
        });
      }
      const row = map.get(key)!;
      if (alias && !row.affiliateAlias) row.affiliateAlias = alias;
      if (!row.platformName) {
        row.platformName = inferPlatformNameFromAlias(alias);
      }
      row.totalCost += Number(ad.cost);
      row.totalClicks += ad.clicks;
      row.totalImpressions += ad.impressions;
      row.totalBudget = Math.max(row.totalBudget, Number(ad.campaignBudget));
      if (ad.campaignName && !row.campaignNames.includes(ad.campaignName)) {
        row.campaignNames = row.campaignNames
          ? `${row.campaignNames},${ad.campaignName}`
          : ad.campaignName;
      }
    }

    const affiliateClickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
      where: {
        channelAccountId: { in: accountIds },
        clickDate: buildOrderDateRangeFilter(q.startDate, q.endDate)!,
      },
      include: {
        channelAccount: { include: { platform: true } },
      },
    });

    for (const c of affiliateClickRows) {
      if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;
      const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
      const key = this.resolveMerchantRowKey(map, c.merchantId, alias);
      if (!map.has(key)) {
        map.set(key, {
          merchantId: c.merchantId,
          merchantName: c.merchantName,
          affiliateAlias: alias,
          platformName: c.channelAccount.platform.name,
          campaignNames: '',
          orderCount: 0,
          totalCommission: 0,
          totalCost: 0,
          totalClicks: 0,
          affiliateClicks: 0,
          totalImpressions: 0,
          totalBudget: 0,
        });
      }
      const row = map.get(key)!;
      row.affiliateClicks += c.clicks;
      if (!row.merchantName && c.merchantName) {
        row.merchantName = c.merchantName;
      }
      if (!row.platformName) {
        row.platformName = c.channelAccount.platform.name;
      }
    }

    /** RW 商家汇总：orders + comm 均来自 medium/performance 逐日写入 */
    const rwPerformanceByKey = new Map<string, { orders: number; commission: number }>();
    for (const c of affiliateClickRows) {
      if (c.channelAccount.platform?.code !== 'rewardoo') continue;
      if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;
      const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
      const key = this.resolveMerchantRowKey(map, c.merchantId, alias);
      const prev = rwPerformanceByKey.get(key) ?? { orders: 0, commission: 0 };
      rwPerformanceByKey.set(key, {
        orders: prev.orders + c.performanceOrders,
        commission: prev.commission + Number(c.performanceCommission),
      });
    }
    for (const [key, metrics] of rwPerformanceByKey) {
      const row = map.get(key);
      if (row) {
        row.orderCount = metrics.orders;
        row.totalCommission = metrics.commission;
      }
    }

    const summary = Array.from(map.values())
      .map((r, idx) => {
        const cost = r.totalCost;
        const commission = r.totalCommission;
        const roi = cost > 0 ? (commission - cost) / cost : 0;
        const clicks = r.totalClicks;
        const orders = r.orderCount;
        return {
          rank: idx + 1,
          ...r,
          cr: clicks > 0 ? (orders / clicks) * 100 : 0,
          epc: clicks > 0 ? commission / clicks : 0,
          cpc: clicks > 0 ? cost / clicks : 0,
          roi,
          profit: commission - cost,
        };
      })
      .sort(
        (a, b) =>
          b.totalCommission - a.totalCommission || b.totalClicks - a.totalClicks,
      )
      .map((r, i) => ({ ...r, rank: i + 1 }));

    const totals = summary.reduce(
      (acc, r) => {
        acc.orderCount += r.orderCount;
        acc.totalCommission += r.totalCommission;
        acc.totalAdSpend += r.totalCost;
        acc.totalClicks += r.totalClicks;
        acc.totalAffiliateClicks += r.affiliateClicks;
        return acc;
      },
      { orderCount: 0, totalCommission: 0, totalAdSpend: 0, totalClicks: 0, totalAffiliateClicks: 0 },
    );

    const overallRoi =
      totals.totalAdSpend > 0
        ? (totals.totalCommission - totals.totalAdSpend) / totals.totalAdSpend
        : 0;

    return {
      summary,
      totals: {
        ...totals,
        overallRoi,
        profit: totals.totalCommission - totals.totalAdSpend,
      },
    };
  }

  /**
   * 广告系列维度汇总（对齐徐版 Sheet：Google Ads 指标 + 联盟订单/点击/佣金）
   */
  async campaignSummary(user: AuthUser, q: ReportDateQuery) {
    const ownerId = resolveOwnerUserId(user, q.userId);
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: ownerId },
      select: { id: true, affiliateAlias: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const affiliateMetrics = await this.buildAffiliateMetricsByMerchant(
      accountIds,
      q.startDate,
      q.endDate,
    );

    const adRows = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId: ownerId,
        date: buildOrderDateRangeFilter(q.startDate, q.endDate)!,
      },
    });

    type CampaignAgg = {
      campaignGroupKey: string;
      campaignId: string;
      customerId: string;
      campaignName: string;
      campaignStatus: string;
      latestStatusDate: string;
      affiliateAlias: string;
      merchantId: string;
      linkedCustomerIds: string[];
      dailyBudget: number;
      impressions: number;
      clicks: number;
      cost: number;
      searchBudgetLostIs: number;
      searchRankLostIs: number;
      maxCpc: number;
    };

    const map = new Map<string, CampaignAgg>();

    for (const ad of adRows) {
      const parsed = parseCampaignName(ad.campaignName);
      const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
      const merchantId = ad.merchantId || parsed.merchantId;
      const key = resolveCampaignGroupKey({
        campaignName: ad.campaignName,
        merchantId,
        affiliateAlias: alias,
        customerId: ad.customerId,
        campaignId: ad.campaignId,
      });

      if (!map.has(key)) {
        map.set(key, {
          campaignGroupKey: key,
          campaignId: ad.campaignId,
          customerId: ad.customerId,
          campaignName: ad.campaignName,
          campaignStatus: ad.campaignStatus ?? '',
          latestStatusDate: '',
          affiliateAlias: alias,
          merchantId,
          linkedCustomerIds: ad.customerId ? [ad.customerId] : [],
          dailyBudget: 0,
          impressions: 0,
          clicks: 0,
          cost: 0,
          searchBudgetLostIs: 0,
          searchRankLostIs: 0,
          maxCpc: 0,
        });
      }

      const row = map.get(key)!;
      const dateStr = ad.date.toISOString().slice(0, 10);
      if (ad.customerId && !row.linkedCustomerIds.includes(ad.customerId)) {
        row.linkedCustomerIds.push(ad.customerId);
      }
      if (!row.latestStatusDate || dateStr >= row.latestStatusDate) {
        row.latestStatusDate = dateStr;
        row.campaignName = ad.campaignName;
        row.customerId = ad.customerId;
        row.campaignId = ad.campaignId;
        if (ad.campaignStatus) {
          row.campaignStatus = ad.campaignStatus;
        }
      }
      const prevImpressions = row.impressions;
      const impressions = ad.impressions;
      row.impressions += impressions;
      row.clicks += ad.clicks;
      row.cost += Number(ad.cost);
      row.dailyBudget = Math.max(row.dailyBudget, Number(ad.campaignBudget));
      row.maxCpc = Math.max(row.maxCpc, Number(ad.maxCpc));
      row.searchBudgetLostIs = this.weightedPercent(
        row.searchBudgetLostIs,
        prevImpressions,
        Number(ad.searchBudgetLostIs),
        impressions,
      );
      row.searchRankLostIs = this.weightedPercent(
        row.searchRankLostIs,
        prevImpressions,
        Number(ad.searchRankLostIs),
        impressions,
      );
      if (!row.merchantId && merchantId) row.merchantId = merchantId;
      if (!row.affiliateAlias && alias) row.affiliateAlias = alias;
    }

    await this.supplementCampaignsForAffiliateOrders_(ownerId, map, affiliateMetrics);
    await this.supplementOrphanMerchantCampaigns_(map, affiliateMetrics, accountIds, q.startDate, q.endDate);

    const affiliateByDay = await this.buildAffiliateMetricsByMerchantDay(
      accountIds,
      q.startDate,
      q.endDate,
    );
    const clicksByCampaign = this.computeAffiliateClicksByCampaignKey(
      adRows,
      affiliateByDay,
      q.startDate,
      q.endDate,
    );

    let summary = [...map.values()]
      .map((r) => {
        const affiliate = this.lookupAffiliateMetrics(
          affiliateMetrics,
          r.merchantId,
          r.affiliateAlias,
        );
        const cost = r.cost;
        const commission = affiliate.commission;
        const clicks = r.clicks;
        const roi = cost > 0 ? (commission - cost) / cost : 0;
        const avgCpc = clicks > 0 ? cost / clicks : 0;
        const epc = clicks > 0 ? commission / clicks : 0;
        const affiliateClicks =
          clicksByCampaign.get(r.campaignGroupKey) ?? affiliate.affiliateClicks;

        return {
          campaignGroupKey: r.campaignGroupKey,
          campaignId: r.campaignId,
          customerId: r.customerId,
          campaignName: r.campaignName,
          campaignStatus: r.campaignStatus,
          affiliateAlias: r.affiliateAlias,
          merchantId: r.merchantId,
          linkedCustomerIds: r.linkedCustomerIds,
          dailyBudget: r.dailyBudget,
          impressions: r.impressions,
          clicks,
          cost,
          orderCount: affiliate.orderCount,
          commission,
          affiliateClicks,
          searchBudgetLostIs: r.searchBudgetLostIs,
          searchRankLostIs: r.searchRankLostIs,
          avgCpc,
          maxCpc: r.maxCpc,
          epc,
          roi,
          profit: commission - cost,
          operationSuggestion: suggestOperation(roi, affiliate.orderCount, cost),
        };
      });

    summary = this.dedupeAffiliateAttributionOnCampaigns(summary);
    summary.sort((a, b) => b.roi - a.roi || b.commission - a.commission || b.clicks - a.clicks);

    const countBeforeStatusFilter = summary.length;
    const hasStatusInRange = adRows.some((ad) => !!(ad.campaignStatus ?? '').trim());

    const statusMode = resolveCampaignStatusMode(q);
    summary = filterRowsByCampaignStatusMode(summary, statusMode);

    const statusFilterSkipped =
      statusMode === 'active' &&
      countBeforeStatusFilter > 0 &&
      summary.length === 0 &&
      !hasStatusInRange;

    summary = summary.map((r, i) => ({ ...r, rank: i + 1 }));

    const totals = summary.reduce(
      (acc, r) => {
        acc.impressions += r.impressions;
        acc.clicks += r.clicks;
        acc.cost += r.cost;
        acc.orderCount += r.orderCount;
        acc.commission += r.commission;
        acc.affiliateClicks += r.affiliateClicks;
        return acc;
      },
      {
        impressions: 0,
        clicks: 0,
        cost: 0,
        orderCount: 0,
        commission: 0,
        affiliateClicks: 0,
      },
    );

    const overallRoi =
      totals.cost > 0 ? (totals.commission - totals.cost) / totals.cost : 0;

    return {
      summary,
      campaignCount: summary.length,
      statusMode,
      enabledOnly: statusMode === 'active',
      statusFilterSkipped,
      totalBeforeStatusFilter: countBeforeStatusFilter,
      totals: { ...totals, overallRoi, profit: totals.commission - totals.cost },
    };
  }

  /**
   * 广告系列 × 自然日明细（Google Ads 日数据 + 当日联盟订单/点击）
   */
  async campaignDaily(user: AuthUser, q: ReportDateQuery) {
    const ownerId = resolveOwnerUserId(user, q.userId);
    const accounts = await this.prisma.channelAccount.findMany({
      where: { ownerUserId: ownerId },
      select: { id: true, affiliateAlias: true },
    });
    const accountIds = accounts.map((a) => a.id);

    const affiliateByDay = await this.buildAffiliateMetricsByMerchantDay(
      accountIds,
      q.startDate,
      q.endDate,
    );

    const adRows = await this.prisma.adCampaignDaily.findMany({
      where: {
        ownerUserId: ownerId,
        date: buildOrderDateRangeFilter(q.startDate, q.endDate)!,
      },
      orderBy: [{ date: 'desc' }, { campaignName: 'asc' }],
    });

    let rows = this.supplementAffiliateOnlyDailyRows_(
      this.mergeCampaignDailyByGroup_(
        adRows.map((ad) => {
          const dateStr = ad.date.toISOString().slice(0, 10);
          const parsed = parseCampaignName(ad.campaignName);
          const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
          const merchantId = ad.merchantId || parsed.merchantId;
          const affiliate = this.lookupAffiliateMetricsForDay(
            affiliateByDay,
            merchantId,
            alias,
            dateStr,
          );
          const cost = Number(ad.cost);
          const clicks = ad.clicks;
          const commission = affiliate.commission;
          const roi = cost > 0 ? (commission - cost) / cost : 0;
          const avgCpc = clicks > 0 ? cost / clicks : Number(ad.avgCpc);
          const campaignGroupKey = resolveCampaignGroupKey({
            campaignName: ad.campaignName,
            merchantId,
            affiliateAlias: alias,
            customerId: ad.customerId,
            campaignId: ad.campaignId,
          });

          return {
            date: dateStr,
            campaignGroupKey,
            customerId: ad.customerId,
            campaignId: ad.campaignId,
            campaignName: ad.campaignName,
            campaignStatus: ad.campaignStatus ?? '',
            affiliateAlias: alias,
            merchantId,
            dailyBudget: Number(ad.campaignBudget),
            impressions: ad.impressions,
            clicks,
            cost,
            orderCount: affiliate.orderCount,
            commission,
            affiliateClicks: affiliate.affiliateClicks,
            searchBudgetLostIs: Number(ad.searchBudgetLostIs),
            searchRankLostIs: Number(ad.searchRankLostIs),
            avgCpc,
            maxCpc: Number(ad.maxCpc),
            epc: clicks > 0 ? commission / clicks : 0,
            roi,
            profit: commission - cost,
            operationSuggestion: suggestOperation(roi, affiliate.orderCount, cost),
          };
        }),
      ),
      affiliateByDay,
      q.startDate,
      q.endDate,
    );

    rows = this.dedupeAffiliateAttributionOnCampaignDaily(rows);

    const statusMode = resolveCampaignStatusMode(q);
    rows = filterCampaignDailyByGroupStatus(rows, statusMode);

    rows.sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.cost - a.cost ||
        a.campaignName.localeCompare(b.campaignName),
    );

    const dates = [...new Set(rows.map((r) => r.date))].sort((a, b) => b.localeCompare(a));

    const totals = rows.reduce(
      (acc, r) => {
        acc.impressions += r.impressions;
        acc.clicks += r.clicks;
        acc.cost += r.cost;
        acc.orderCount += r.orderCount;
        acc.commission += r.commission;
        acc.affiliateClicks += r.affiliateClicks;
        return acc;
      },
      {
        impressions: 0,
        clicks: 0,
        cost: 0,
        orderCount: 0,
        commission: 0,
        affiliateClicks: 0,
      },
    );
    const overallRoi = totals.cost > 0 ? (totals.commission - totals.cost) / totals.cost : 0;

    return {
      rows,
      dates,
      rowCount: rows.length,
      totals: { ...totals, overallRoi, profit: totals.commission - totals.cost },
    };
  }

  /**
   * 按商家+联盟序号汇总联盟侧指标；额外按 merchantId 索引（广告系列 pm2 与账号 pm1 可对齐）
   */
  private async buildAffiliateMetricsByMerchant(
    accountIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<AffiliateMetricsIndex> {
    const byKey = new Map<string, AffiliateMetrics>();
    const byMerchantId = new Map<string, AffiliateMetrics>();

    if (!accountIds.length) {
      return { byKey, byMerchantId };
    }

    const ensure = (map: Map<string, AffiliateMetrics>, key: string) => {
      if (!map.has(key)) map.set(key, { ...EMPTY_AFFILIATE });
      return map.get(key)!;
    };

    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        orderDate: this.orderDateRange(startDate, endDate),
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    const orderSeenByKey = new Set<string>();
    const orderSeenByMerchant = new Set<string>();
    for (const o of orders) {
      const merchantId = o.merchantId ?? '';
      const alias = (o.channelAccount.affiliateAlias || '').toLowerCase();
      const merchantKey = `${merchantId}|${alias}`;
      const orderKey = `${o.channelAccountId}|${dedupeAffiliateOrderRecord(o)}`;
      const comm = Number(o.commission);
      const isRw = o.channelAccount.platform?.code === 'rewardoo';

      ensure(byKey, merchantKey).commission += isRw ? 0 : comm;
      ensure(byMerchantId, merchantId).commission += isRw ? 0 : comm;

      if (!isRw && !orderSeenByKey.has(orderKey)) {
        orderSeenByKey.add(orderKey);
        ensure(byKey, merchantKey).orderCount += 1;
      }
      const midOrderKey = `${merchantId}|${orderKey}`;
      if (!isRw && !orderSeenByMerchant.has(midOrderKey)) {
        orderSeenByMerchant.add(midOrderKey);
        ensure(byMerchantId, merchantId).orderCount += 1;
      }
    }

    const clickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
      where: {
        channelAccountId: { in: accountIds },
        clickDate: buildOrderDateRangeFilter(startDate, endDate)!,
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    for (const c of clickRows) {
      if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;
      const merchantId = c.merchantId;
      const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
      const merchantKey = `${merchantId}|${alias}`;
      ensure(byKey, merchantKey).affiliateClicks += c.clicks;
      ensure(byMerchantId, merchantId).affiliateClicks += c.clicks;
    }

    this.overlayRwPerformanceDaily(clickRows, byKey, undefined, byMerchantId);

    return { byKey, byMerchantId };
  }

  /**
   * 按商家+联盟序号+自然日汇总联盟订单与点击
   */
  private async buildAffiliateMetricsByMerchantDay(
    accountIds: number[],
    startDate: string,
    endDate: string,
  ): Promise<{
    byKey: Map<string, AffiliateMetrics>;
    byMerchantDay: Map<string, AffiliateMetrics>;
  }> {
    const byKey = new Map<string, AffiliateMetrics>();
    const byMerchantDay = new Map<string, AffiliateMetrics>();

    if (!accountIds.length) {
      return { byKey, byMerchantDay };
    }

    const ensureKey = (map: Map<string, AffiliateMetrics>, key: string) => {
      if (!map.has(key)) map.set(key, { ...EMPTY_AFFILIATE });
      return map.get(key)!;
    };

    const orders = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        orderDate: this.orderDateRange(startDate, endDate),
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    const orderSeenByKey = new Set<string>();
    const orderSeenByMerchantDay = new Set<string>();
    for (const o of orders) {
      const merchantId = o.merchantId ?? '';
      if (!merchantId) continue;
      const alias = (o.channelAccount.affiliateAlias || '').toLowerCase();
      const dateStr = o.orderDate.toISOString().slice(0, 10);
      const dayKey = `${merchantId}|${alias}|${dateStr}`;
      const merchantDayKey = `${merchantId}|${dateStr}`;
      const orderKey = `${o.channelAccountId}|${dedupeAffiliateOrderRecord(o)}`;
      const comm = Number(o.commission);
      const isRw = o.channelAccount.platform?.code === 'rewardoo';

      if (!isRw) {
        ensureKey(byKey, dayKey).commission += comm;
        ensureKey(byMerchantDay, merchantDayKey).commission += comm;
      }

      if (!isRw && !orderSeenByKey.has(`${dayKey}|${orderKey}`)) {
        orderSeenByKey.add(`${dayKey}|${orderKey}`);
        ensureKey(byKey, dayKey).orderCount += 1;
      }
      const midOrderKey = `${merchantDayKey}|${orderKey}`;
      if (!isRw && !orderSeenByMerchantDay.has(midOrderKey)) {
        orderSeenByMerchantDay.add(midOrderKey);
        ensureKey(byMerchantDay, merchantDayKey).orderCount += 1;
      }
    }

    const clickRows = await this.prisma.affiliateMerchantClickDaily.findMany({
      where: {
        channelAccountId: { in: accountIds },
        clickDate: buildOrderDateRangeFilter(startDate, endDate)!,
      },
      include: { channelAccount: { include: { platform: true } } },
    });

    for (const c of clickRows) {
      if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;
      const merchantId = c.merchantId;
      const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
      const dateStr = formatCalendarDateUtc(c.clickDate);
      const dayKey = `${merchantId}|${alias}|${dateStr}`;
      const merchantDayKey = `${merchantId}|${dateStr}`;
      ensureKey(byKey, dayKey).affiliateClicks += c.clicks;
      ensureKey(byMerchantDay, merchantDayKey).affiliateClicks += c.clicks;
    }

    this.overlayRwPerformanceDaily(clickRows, byKey, byMerchantDay);

    return { byKey, byMerchantDay };
  }

  /**
   * RW 按天指标覆盖：orders + comm + clicks 均来自 medium/performance 逐日写入
   */
  private overlayRwPerformanceDaily(
    clickRows: Array<{
      merchantId: string;
      clickDate: Date;
      performanceOrders: number;
      performanceCommission: unknown;
      clicks: number;
      channelAccount: {
        affiliateAlias: string | null;
        platform?: { code: string };
      };
    }>,
    byKey: Map<string, AffiliateMetrics>,
    byMerchantDay?: Map<string, AffiliateMetrics>,
    byMerchantId?: Map<string, AffiliateMetrics>,
  ) {
    const ensure = (map: Map<string, AffiliateMetrics>, key: string) => {
      if (!map.has(key)) map.set(key, { ...EMPTY_AFFILIATE });
      return map.get(key)!;
    };

    if (byMerchantDay) {
      const ordersByMerchantDay = new Map<string, number>();
      const commByMerchantDay = new Map<string, number>();
      for (const c of clickRows) {
        if (c.channelAccount.platform?.code !== 'rewardoo') continue;
        if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;

        const dateStr = formatCalendarDateUtc(c.clickDate);
        const merchantDayKey = `${c.merchantId}|${dateStr}`;
        ordersByMerchantDay.set(
          merchantDayKey,
          (ordersByMerchantDay.get(merchantDayKey) ?? 0) + c.performanceOrders,
        );
        commByMerchantDay.set(
          merchantDayKey,
          (commByMerchantDay.get(merchantDayKey) ?? 0) + Number(c.performanceCommission),
        );
      }

      for (const [merchantDayKey, orders] of ordersByMerchantDay) {
        const commission = commByMerchantDay.get(merchantDayKey) ?? 0;
        ensure(byMerchantDay, merchantDayKey).orderCount = orders;
        ensure(byMerchantDay, merchantDayKey).commission = commission;
        const [merchantId, dateStr] = merchantDayKey.split('|');
        for (const c of clickRows) {
          if (c.merchantId !== merchantId) continue;
          if (formatCalendarDateUtc(c.clickDate) !== dateStr) continue;
          if (c.channelAccount.platform?.code !== 'rewardoo') continue;
          const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
          const dayMetrics = ensure(byKey, `${merchantId}|${alias}|${dateStr}`);
          dayMetrics.orderCount = orders;
          dayMetrics.commission = commission;
        }
      }
    }

    if (byMerchantId) {
      const ordersByMerchant = new Map<string, number>();
      const commByMerchant = new Map<string, number>();
      for (const c of clickRows) {
        if (c.channelAccount.platform?.code !== 'rewardoo') continue;
        if (isLbClickPseudoMerchant(c.merchantId) || isRwClickPseudoMerchant(c.merchantId)) continue;

        ordersByMerchant.set(
          c.merchantId,
          (ordersByMerchant.get(c.merchantId) ?? 0) + c.performanceOrders,
        );
        commByMerchant.set(
          c.merchantId,
          (commByMerchant.get(c.merchantId) ?? 0) + Number(c.performanceCommission),
        );
      }

      for (const [merchantId, orders] of ordersByMerchant) {
        const commission = commByMerchant.get(merchantId) ?? 0;
        ensure(byMerchantId, merchantId).orderCount = orders;
        ensure(byMerchantId, merchantId).commission = commission;
        for (const c of clickRows) {
          if (c.merchantId !== merchantId) continue;
          if (c.channelAccount.platform?.code !== 'rewardoo') continue;
          const alias = (c.channelAccount.affiliateAlias || '').toLowerCase();
          const rangeMetrics = ensure(byKey, `${merchantId}|${alias}`);
          rangeMetrics.orderCount = orders;
          rangeMetrics.commission = commission;
        }
      }
    }
  }

  private lookupAffiliateMetricsForDay(
    index: { byKey: Map<string, AffiliateMetrics>; byMerchantDay: Map<string, AffiliateMetrics> },
    merchantId: string,
    alias: string,
    dateStr: string,
  ): AffiliateMetrics {
    if (!merchantId) return { ...EMPTY_AFFILIATE };
    const campaignAlias = (alias || '').toLowerCase();

    /** RW 按商家+日（与 RW Performance Daily 一致），不用 alias 精确键避免漏单 */
    if (campaignAlias.startsWith('rw')) {
      return index.byMerchantDay.get(`${merchantId}|${dateStr}`) ?? { ...EMPTY_AFFILIATE };
    }

    const exact = index.byKey.get(`${merchantId}|${campaignAlias}|${dateStr}`);
    if (exact) return exact;

    if (campaignAlias.startsWith('pm')) {
      return index.byMerchantDay.get(`${merchantId}|${dateStr}`) ?? { ...EMPTY_AFFILIATE };
    }

    /** LB/LH 按天：同商家同序号精确匹配，否则回退到商家当日合计（与 PM 一致） */
    if (campaignAlias.startsWith('lb') || campaignAlias.startsWith('lh')) {
      return index.byMerchantDay.get(`${merchantId}|${dateStr}`) ?? { ...EMPTY_AFFILIATE };
    }

    return { ...EMPTY_AFFILIATE };
  }

  /**
   * 按「有 Google Ads 数据的日期」汇总联盟点击（与展开明细合计一致）
   */
  private computeAffiliateClicksByCampaignKey(
    adRows: Array<{
      customerId: string;
      campaignId: string;
      campaignName: string;
      date: Date;
      affiliateAlias: string | null;
      merchantId: string | null;
      cost: unknown;
      clicks: number;
    }>,
    affiliateByDay: Awaited<ReturnType<typeof this.buildAffiliateMetricsByMerchantDay>>,
    startDate: string,
    endDate: string,
  ): Map<string, number> {
    type DayRow = {
      date: string;
      campaignId: string;
      customerId: string;
      campaignName: string;
      merchantId: string;
      affiliateAlias: string;
      cost: number;
      clicks: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      roi: number;
      profit: number;
      epc: number;
      operationSuggestion: string;
    };

    const raw: DayRow[] = adRows.map((ad) => {
      const dateStr = ad.date.toISOString().slice(0, 10);
      const parsed = parseCampaignName(ad.campaignName);
      const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
      const merchantId = ad.merchantId || parsed.merchantId;
      const affiliate = this.lookupAffiliateMetricsForDay(
        affiliateByDay,
        merchantId,
        alias,
        dateStr,
      );
      const cost = Number(ad.cost);
      const clicks = ad.clicks;
      const roi = cost > 0 ? (affiliate.commission - cost) / cost : 0;
      return {
        date: dateStr,
        campaignId: ad.campaignId,
        customerId: ad.customerId,
        campaignName: ad.campaignName,
        merchantId,
        affiliateAlias: alias,
        cost,
        clicks,
        orderCount: affiliate.orderCount,
        commission: affiliate.commission,
        affiliateClicks: affiliate.affiliateClicks,
        roi,
        profit: affiliate.commission - cost,
        epc: clicks > 0 ? affiliate.commission / clicks : 0,
        operationSuggestion: suggestOperation(roi, affiliate.orderCount, cost),
      };
    });

    const deduped = this.dedupeAffiliateAttributionOnCampaignDaily(
      this.supplementAffiliateOnlyDailyRows_(
        this.mergeCampaignDailyByGroup_(
          raw.map((r) => ({
            ...r,
            campaignGroupKey: resolveCampaignGroupKey({
              campaignName: r.campaignName,
              merchantId: r.merchantId,
              affiliateAlias: r.affiliateAlias,
              customerId: r.customerId,
              campaignId: r.campaignId,
            }),
            campaignName: r.campaignName,
            campaignStatus: '',
            dailyBudget: 0,
            impressions: 0,
            searchBudgetLostIs: 0,
            searchRankLostIs: 0,
            avgCpc: 0,
            maxCpc: 0,
          })),
        ),
        affiliateByDay,
        startDate,
        endDate,
      ),
    );
    const byCampaign = new Map<string, number>();
    for (const r of deduped) {
      const key = r.campaignGroupKey;
      byCampaign.set(key, (byCampaign.get(key) ?? 0) + r.affiliateClicks);
    }
    return byCampaign;
  }

  /**
   * 同一逻辑系列 × 自然日：合并多个 Google 子账号的广告指标（联盟指标不重复累加）
   */
  private mergeCampaignDailyByGroup_<
    T extends {
      date: string;
      campaignGroupKey: string;
      customerId: string;
      campaignId: string;
      campaignName: string;
      campaignStatus: string;
      affiliateAlias: string;
      merchantId: string;
      dailyBudget: number;
      impressions: number;
      clicks: number;
      cost: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      searchBudgetLostIs: number;
      searchRankLostIs: number;
      avgCpc: number;
      maxCpc: number;
      epc: number;
      roi: number;
      profit: number;
      operationSuggestion: string;
    },
  >(rows: T[]): T[] {
    const map = new Map<string, T>();

    for (const row of rows) {
      const key = `${row.campaignGroupKey}|${row.date}`;
      if (!map.has(key)) {
        map.set(key, { ...row });
        continue;
      }

      const prev = map.get(key)!;
      const prevImpressions = prev.impressions;
      const impressions = row.impressions;
      const clicks = prev.clicks + row.clicks;
      const cost = prev.cost + row.cost;
      const commission = prev.commission;
      const orderCount = prev.orderCount;
      const affiliateClicks = prev.affiliateClicks;
      const roi = cost > 0 ? (commission - cost) / cost : 0;

      map.set(key, {
        ...prev,
        customerId: row.cost >= prev.cost ? row.customerId : prev.customerId,
        campaignId: row.cost >= prev.cost ? row.campaignId : prev.campaignId,
        campaignName: row.cost >= prev.cost ? row.campaignName : prev.campaignName,
        campaignStatus: row.cost >= prev.cost ? row.campaignStatus : prev.campaignStatus,
        dailyBudget: Math.max(prev.dailyBudget, row.dailyBudget),
        impressions: prev.impressions + impressions,
        clicks,
        cost,
        orderCount,
        commission,
        affiliateClicks,
        searchBudgetLostIs: this.weightedPercent(
          prev.searchBudgetLostIs,
          prevImpressions,
          row.searchBudgetLostIs,
          impressions,
        ),
        searchRankLostIs: this.weightedPercent(
          prev.searchRankLostIs,
          prevImpressions,
          row.searchRankLostIs,
          impressions,
        ),
        maxCpc: Math.max(prev.maxCpc, row.maxCpc),
        avgCpc: clicks > 0 ? cost / clicks : 0,
        epc: clicks > 0 ? commission / clicks : 0,
        roi,
        profit: commission - cost,
        operationSuggestion: suggestOperation(roi, orderCount, cost),
      });
    }

    return [...map.values()];
  }

  /**
   * 换 Google 子账号空窗日：MCC 无花费，但联盟有点击/订单时补一行（广告费为 0）
   */
  private supplementAffiliateOnlyDailyRows_<
    T extends {
      date: string;
      campaignGroupKey: string;
      customerId: string;
      campaignId: string;
      campaignName: string;
      campaignStatus: string;
      affiliateAlias: string;
      merchantId: string;
      dailyBudget: number;
      impressions: number;
      clicks: number;
      cost: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      searchBudgetLostIs: number;
      searchRankLostIs: number;
      avgCpc: number;
      maxCpc: number;
      epc: number;
      roi: number;
      profit: number;
      operationSuggestion: string;
    },
  >(
    rows: T[],
    affiliateByDay: Awaited<ReturnType<typeof this.buildAffiliateMetricsByMerchantDay>>,
    startDate: string,
    endDate: string,
  ): T[] {
    const out = [...rows];
    const seen = new Set(rows.map((r) => `${r.campaignGroupKey}|${r.date}`));
    const templates = new Map<string, T>();

    for (const row of rows) {
      if (!templates.has(row.campaignGroupKey)) {
        templates.set(row.campaignGroupKey, row);
      }
    }

    for (const tpl of templates.values()) {
      if (!tpl.merchantId) continue;

      for (const dateStr of this.listDatesInRange_(startDate, endDate)) {
        const dayKey = `${tpl.campaignGroupKey}|${dateStr}`;
        if (seen.has(dayKey)) continue;

        const affiliate = this.lookupAffiliateMetricsForDay(
          affiliateByDay,
          tpl.merchantId,
          tpl.affiliateAlias,
          dateStr,
        );
        if (
          affiliate.orderCount <= 0 &&
          affiliate.commission <= 0 &&
          affiliate.affiliateClicks <= 0
        ) {
          continue;
        }

        seen.add(dayKey);
        out.push({
          ...tpl,
          date: dateStr,
          impressions: 0,
          clicks: 0,
          cost: 0,
          dailyBudget: 0,
          searchBudgetLostIs: 0,
          searchRankLostIs: 0,
          avgCpc: 0,
          maxCpc: 0,
          orderCount: affiliate.orderCount,
          commission: affiliate.commission,
          affiliateClicks: affiliate.affiliateClicks,
          roi: 0,
          profit: affiliate.commission,
          epc: 0,
          operationSuggestion: suggestOperation(0, affiliate.orderCount, 0),
        });
      }
    }

    return out;
  }

  /** 生成闭区间内的 YYYY-MM-DD 日期列表 */
  private listDatesInRange_(startDate: string, endDate: string): string[] {
    const out: string[] = [];
    const cur = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);
    while (cur <= end) {
      out.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return out;
  }

  /** 按自然日分别做联盟订单归因去重 */
  private dedupeAffiliateAttributionOnCampaignDaily<
    T extends {
      date: string;
      campaignId: string;
      merchantId: string;
      affiliateAlias: string;
      cost: number;
      clicks: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      roi: number;
      profit: number;
      epc: number;
      operationSuggestion: string;
    },
  >(rows: T[]): T[] {
    const byDate = new Map<string, T[]>();
    for (const r of rows) {
      if (!byDate.has(r.date)) byDate.set(r.date, []);
      byDate.get(r.date)!.push(r);
    }
    const merged: T[] = [];
    for (const dayRows of byDate.values()) {
      merged.push(...this.dedupeAffiliateAttributionOnCampaigns(dayRows));
    }
    return merged;
  }

  /**
   * 查询区间内有联盟订单/佣金，但区间内无 Google 花费的系列：用历史最近一条广告日数据补一行（花费为 0，订单仍归因）。
   * 解决「系列已停投、花费在区间外、订单在区间内」无法匹配的问题（如 Nina Shoes）。
   */
  private async supplementCampaignsForAffiliateOrders_(
    ownerId: number,
    map: Map<
      string,
      {
        campaignGroupKey: string;
        campaignId: string;
        customerId: string;
        campaignName: string;
        campaignStatus: string;
        latestStatusDate: string;
        affiliateAlias: string;
        merchantId: string;
        linkedCustomerIds: string[];
        dailyBudget: number;
        impressions: number;
        clicks: number;
        cost: number;
        searchBudgetLostIs: number;
        searchRankLostIs: number;
        maxCpc: number;
      }
    >,
    affiliateMetrics: AffiliateMetricsIndex,
  ) {
    const histRows = await this.prisma.adCampaignDaily.findMany({
      where: { ownerUserId: ownerId },
      orderBy: { date: 'desc' },
      select: {
        customerId: true,
        campaignId: true,
        campaignName: true,
        campaignStatus: true,
        affiliateAlias: true,
        merchantId: true,
        campaignBudget: true,
        maxCpc: true,
      },
    });

    const seen = new Set<string>();
    for (const ad of histRows) {
      const parsed = parseCampaignName(ad.campaignName);
      const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
      const merchantId = ad.merchantId || parsed.merchantId;
      const groupKey = resolveCampaignGroupKey({
        campaignName: ad.campaignName,
        merchantId,
        affiliateAlias: alias,
        customerId: ad.customerId,
        campaignId: ad.campaignId,
      });
      const physicalKey = `${ad.customerId}|${ad.campaignId}`;
      if (seen.has(physicalKey) || map.has(groupKey)) {
        seen.add(physicalKey);
        continue;
      }
      seen.add(physicalKey);

      const affiliate = this.lookupAffiliateMetrics(affiliateMetrics, merchantId, alias);
      if (affiliate.orderCount === 0 && affiliate.commission === 0) continue;
      if (campaignCoversMerchantAffiliate([...map.values()], merchantId, alias)) continue;

      map.set(groupKey, {
        campaignGroupKey: groupKey,
        campaignId: ad.campaignId,
        customerId: ad.customerId,
        campaignName: ad.campaignName,
        campaignStatus: ad.campaignStatus ?? '',
        latestStatusDate: '',
        affiliateAlias: alias,
        merchantId,
        linkedCustomerIds: ad.customerId ? [ad.customerId] : [],
        dailyBudget: Number(ad.campaignBudget),
        impressions: 0,
        clicks: 0,
        cost: 0,
        searchBudgetLostIs: 0,
        searchRankLostIs: 0,
        maxCpc: Number(ad.maxCpc),
      });
    }
  }

  /**
   * 有联盟订单但 Sheet/历史均无对应广告系列时补一行（花费 0，订单仍展示）
   */
  private async supplementOrphanMerchantCampaigns_(
    map: Map<
      string,
      {
        campaignGroupKey: string;
        campaignId: string;
        customerId: string;
        campaignName: string;
        campaignStatus: string;
        latestStatusDate: string;
        affiliateAlias: string;
        merchantId: string;
        linkedCustomerIds: string[];
        dailyBudget: number;
        impressions: number;
        clicks: number;
        cost: number;
        searchBudgetLostIs: number;
        searchRankLostIs: number;
        maxCpc: number;
      }
    >,
    affiliateMetrics: AffiliateMetricsIndex,
    accountIds: number[],
    startDate: string,
    endDate: string,
  ) {
    const orphanMids: string[] = [];
    for (const [merchantKey, metrics] of affiliateMetrics.byKey) {
      if (metrics.orderCount <= 0 && metrics.commission <= 0) continue;
      const pipe = merchantKey.indexOf('|');
      if (pipe < 0) continue;
      const merchantId = merchantKey.slice(0, pipe);
      const alias = merchantKey.slice(pipe + 1);
      const hasCampaign = campaignCoversMerchantAffiliate([...map.values()], merchantId, alias);
      if (!hasCampaign) orphanMids.push(merchantId);
    }

    if (!orphanMids.length) return;

    const nameRows = await this.prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: { in: accountIds },
        merchantId: { in: orphanMids },
        orderDate: this.orderDateRange(startDate, endDate),
      },
      select: { merchantId: true, merchantName: true },
      distinct: ['merchantId'],
    });
    const nameByMid = new Map(
      nameRows.map((r) => [r.merchantId ?? '', r.merchantName ?? '']),
    );

    for (const [merchantKey, metrics] of affiliateMetrics.byKey) {
      if (metrics.orderCount <= 0 && metrics.commission <= 0) continue;
      const pipe = merchantKey.indexOf('|');
      if (pipe < 0) continue;
      const merchantId = merchantKey.slice(0, pipe);
      const alias = merchantKey.slice(pipe + 1);
      if (campaignCoversMerchantAffiliate([...map.values()], merchantId, alias)) continue;

      const label = nameByMid.get(merchantId) || `商家 ${merchantId}`;
      const orphanCampaignId = `orphan|${merchantId}|${alias}`;
      const groupKey = resolveCampaignGroupKey({
        campaignName: '',
        merchantId,
        affiliateAlias: alias,
        customerId: '',
        campaignId: orphanCampaignId,
      });
      map.set(groupKey, {
        campaignGroupKey: groupKey,
        campaignId: orphanCampaignId,
        customerId: '',
        campaignName: `${label}（无 Sheet 系列 · ${alias}）`,
        campaignStatus: '',
        latestStatusDate: '',
        affiliateAlias: alias,
        merchantId,
        linkedCustomerIds: [],
        dailyBudget: 0,
        impressions: 0,
        clicks: 0,
        cost: 0,
        searchBudgetLostIs: 0,
        searchRankLostIs: 0,
        maxCpc: 0,
      });
    }
  }

  /**
   * 同一商家只向一个广告系列归因联盟订单，避免 PM byMerchantId 兜底、历史补行导致重复计数。
   * 优先归属区间内花费最高者，其次点击、系列 ID。
   */
  private dedupeAffiliateAttributionOnCampaigns<
    T extends {
      campaignId: string;
      merchantId: string;
      affiliateAlias: string;
      cost: number;
      clicks: number;
      orderCount: number;
      commission: number;
      affiliateClicks: number;
      roi: number;
      profit: number;
      epc: number;
      operationSuggestion: string;
    },
  >(rows: T[]): T[] {
    const winnerByKey = new Map<string, number>();

    rows.forEach((row, idx) => {
      if (row.orderCount <= 0 && row.commission <= 0) return;
      const key = campaignAffiliateAttributionKey(row.merchantId, row.affiliateAlias);
      if (!key) return;
      const prevIdx = winnerByKey.get(key);
      if (prevIdx === undefined || this.campaignWinsAffiliateAttribution(rows[prevIdx], row)) {
        winnerByKey.set(key, idx);
      }
    });

    return rows.map((row, idx) => {
      const key = campaignAffiliateAttributionKey(row.merchantId, row.affiliateAlias);
      const winnerIdx = key ? winnerByKey.get(key) : undefined;
      if (winnerIdx === undefined || winnerIdx === idx) return row;

      return {
        ...row,
        orderCount: 0,
        commission: 0,
        affiliateClicks: 0,
        roi: row.cost > 0 ? -1 : 0,
        profit: -row.cost,
        epc: 0,
        operationSuggestion: suggestOperation(row.cost > 0 ? -1 : 0, 0, row.cost),
      };
    });
  }

  private campaignWinsAffiliateAttribution(
    current: { cost: number; clicks: number; campaignId: string },
    candidate: { cost: number; clicks: number; campaignId: string },
  ): boolean {
    if (candidate.cost !== current.cost) return candidate.cost > current.cost;
    if (candidate.clicks !== current.clicks) return candidate.clicks > current.clicks;
    return candidate.campaignId.localeCompare(current.campaignId) > 0;
  }

  /** 优先 merchantId+alias 精确匹配；PM 允许 pm1 账号匹配 pm2 广告系列；LH 等序号必须一致 */
  private lookupAffiliateMetrics(
    index: AffiliateMetricsIndex,
    merchantId: string,
    alias: string,
  ): AffiliateMetrics {
    if (!merchantId) return { ...EMPTY_AFFILIATE };
    const campaignAlias = (alias || '').toLowerCase();

    /** RW 按商家汇总（与 RW 后台商家 Performance 一致） */
    if (campaignAlias.startsWith('rw')) {
      return index.byMerchantId.get(merchantId) ?? { ...EMPTY_AFFILIATE };
    }

    const exact = index.byKey.get(`${merchantId}|${campaignAlias}`);
    if (exact) return exact;

    if (campaignAlias.startsWith('pm')) {
      return index.byMerchantId.get(merchantId) ?? { ...EMPTY_AFFILIATE };
    }

    if (campaignAlias.startsWith('lb') || campaignAlias.startsWith('lh')) {
      return index.byMerchantId.get(merchantId) ?? { ...EMPTY_AFFILIATE };
    }

    return { ...EMPTY_AFFILIATE };
  }

  /**
   * 合并行键：PM 允许跨序号；LH 等同 merchantId 但序号不同则不合并
   */
  private resolveMerchantRowKey<T extends { merchantId: string; affiliateAlias: string; orderCount: number; totalCommission: number }>(
    map: Map<string, T>,
    merchantId: string,
    alias: string,
  ): string {
    const campaignAlias = (alias || '').toLowerCase();
    const exact = `${merchantId}|${campaignAlias}`;
    if (map.has(exact)) return exact;

    if (campaignAlias.startsWith('pm')) {
      for (const [key, row] of map.entries()) {
        if (row.merchantId === merchantId && (row.orderCount > 0 || row.totalCommission > 0)) {
          return key;
        }
      }
      for (const [key, row] of map.entries()) {
        if (row.merchantId === merchantId) return key;
      }
    }

    return exact;
  }

  private weightedPercent(prev: number, prevWeight: number, next: number, nextWeight: number) {
    const total = prevWeight + nextWeight;
    if (total <= 0) return next;
    return (prev * prevWeight + next * nextWeight) / total;
  }

  /**
   * 公司经营看板（管理员）
   */
  async companyDashboard(q: ReportDateQuery) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, role: true },
    });

    const employees = users.filter((u) => u.role !== 'ADMIN');
    const byEmployee: Array<{
      userId: number;
      username: string;
      totalCommission: number;
      totalAdSpend: number;
      roi: number;
      profit: number;
      orderCount: number;
      pendingCommission: number;
      confirmedCommission: number;
      rejectedCommission: number;
    }> = [];

    let companyCommission = 0;
    let companyAdSpend = 0;
    let companyOrders = 0;
    let companyPending = 0;
    let companyConfirmed = 0;
    let companyRejected = 0;

    for (const emp of employees) {
      const report = await this.merchantSummary(
        { id: emp.id, role: 'OPERATOR', organizationId: 1 } as AuthUser,
        { ...q, userId: emp.id },
      );

      const orders = await this.prisma.affiliateOrder.findMany({
        where: {
          channelAccount: { ownerUserId: emp.id },
          orderDate: this.orderDateRange(q.startDate, q.endDate),
        },
      });

      let pending = 0;
      let confirmed = 0;
      let rejected = 0;
      for (const o of orders) {
        const buckets = resolveOrderCommissionBuckets(o);
        pending += buckets.pending;
        confirmed += buckets.approved;
        rejected += buckets.rejected;
      }

      const row = {
        userId: emp.id,
        username: emp.username,
        totalCommission: report.totals.totalCommission,
        totalAdSpend: report.totals.totalAdSpend,
        roi: report.totals.overallRoi,
        profit: report.totals.profit,
        orderCount: report.totals.orderCount,
        pendingCommission: pending,
        confirmedCommission: confirmed,
        rejectedCommission: rejected,
      };
      byEmployee.push(row);
      companyCommission += row.totalCommission;
      companyAdSpend += row.totalAdSpend;
      companyOrders += row.orderCount;
      companyPending += pending;
      companyConfirmed += confirmed;
      companyRejected += rejected;
    }

    const companyRoi =
      companyAdSpend > 0 ? (companyCommission - companyAdSpend) / companyAdSpend : 0;

    return {
      period: q,
      company: {
        totalCommission: companyCommission,
        totalAdSpend: companyAdSpend,
        profit: companyCommission - companyAdSpend,
        overallRoi: companyRoi,
        orderCount: companyOrders,
        pendingCommission: companyPending,
        confirmedCommission: companyConfirmed,
        rejectedCommission: companyRejected,
      },
      byEmployee: byEmployee.sort((a, b) => b.profit - a.profit),
    };
  }

  private emptyTotals() {
    return {
      orderCount: 0,
      totalCommission: 0,
      totalAdSpend: 0,
      totalClicks: 0,
      totalAffiliateClicks: 0,
      overallRoi: 0,
      profit: 0,
    };
  }

  /** 报表日期范围（含结束日全天） */
  private adDateRange(startDate: string, endDate: string) {
    return {
      gte: new Date(`${startDate}T00:00:00.000Z`),
      lte: new Date(`${endDate}T23:59:59.999Z`),
    };
  }

  /**
   * DB 与 Sheet 系列明细对账（不做账户级补齐，与导入口径一致）
   */
  async adSpendCoverage(user: AuthUser, q: ReportDateQuery) {
    const ownerId = resolveOwnerUserId(user, q.userId);
    const dateRange = this.adDateRange(q.startDate, q.endDate);

    const grouped = await this.prisma.adCampaignDaily.groupBy({
      by: ['date'],
      where: { ownerUserId: ownerId, date: dateRange },
      _sum: { cost: true, clicks: true },
      _count: { _all: true },
      orderBy: { date: 'asc' },
    });

    const dailyMap = new Map(
      grouped.map((d) => [
        d.date.toISOString().slice(0, 10),
        {
          cost: Number(d._sum.cost ?? 0),
          clicks: Number(d._sum.clicks ?? 0),
          rowCount: d._count._all,
        },
      ]),
    );

    const allDates = this.listDatesInRange_(q.startDate, q.endDate);
    const daily = allDates.map((date) => ({
      date,
      cost: dailyMap.get(date)?.cost ?? 0,
      clicks: dailyMap.get(date)?.clicks ?? 0,
      rowCount: dailyMap.get(date)?.rowCount ?? 0,
    }));

    const missingDates = daily.filter((d) => d.rowCount === 0).map((d) => d.date);
    const totalCost = daily.reduce((acc, d) => acc + d.cost, 0);

    let sheetTotalCost: number | null = null;
    let sheetRowCount = 0;
    const sources = await this.prisma.adDataSource.findMany({
      where: { ownerUserId: ownerId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 1,
    });
    if (sources.length) {
      try {
        const csvUrl = buildSheetCsvUrl(sources[0].sheetId, sources[0].mainTab);
        const res = await axios.get<string>(csvUrl, {
          timeout: 120000,
          responseType: 'text',
          headers: { 'User-Agent': 'ZJADS/1.0' },
        });
        const sheetRows = parseAdSheetCsv(res.data).filter(
          (r) => r.date >= q.startDate && r.date <= q.endDate,
        );
        sheetRowCount = sheetRows.length;
        sheetTotalCost = sheetRows.reduce((sum, r) => sum + r.cost, 0);
      } catch {
        sheetTotalCost = null;
      }
    }

    return {
      startDate: q.startDate,
      endDate: q.endDate,
      dbTotalCost: totalCost,
      sheetTotalCost,
      sheetRowCount,
      missingDates,
      daily,
      adSpendSource: 'campaign_detail' as const,
    };
  }

  /** 联盟订单日期范围（含结束日全天） */
  private orderDateRange(startDate: string, endDate: string) {
    return {
      gte: new Date(`${startDate}T00:00:00.000Z`),
      lte: new Date(`${endDate}T23:59:59.999Z`),
    };
  }
}
