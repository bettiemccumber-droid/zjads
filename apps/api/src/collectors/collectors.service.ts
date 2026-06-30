import { Injectable, BadRequestException } from '@nestjs/common';
import { AffiliateClickSource, ChannelAccount, Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  fetchPartnerMaticOrders,
  normalizePartnerMaticOrders,
  summarizePmTransactionApi,
} from './partnermatic.collector';
import {
  fetchPartnerMaticClicks,
  PmMerchantClickAgg,
} from './partnermatic-clicks';
import {
  fetchLinkHaitaoCommissions,
  normalizeLinkHaitaoOrders,
  summarizeLhCommissionApi,
} from './linkhaitao.collector';
import {
  fetchLinkBuxOrders,
  normalizeLinkBuxOrders,
  summarizeLbOrdersInRange,
  summarizeLbTransactionApi,
} from './linkbux.collector';
import { buildLbMcidToMidMap, fetchLinkBuxClicks } from './linkbux-clicks';
import { fetchLinkHaitaoClicks, buildLhMcidToMidMap } from './linkhaitao-clicks';
import {
  fetchRewardooCommissions,
  normalizeRewardooOrders,
  summarizeRwCommissionApi,
} from './rewardoo.collector';
import { fetchRewardooClicks } from './rewardoo-clicks';
import { ensurePlatformStatusMappings } from '../common/platform-status-defaults.util';
import {
  collectorNotReadyMessage,
  isCollectorImplemented,
} from './collectors.registry';
import { isOrderDateInReportRange } from '../common/affiliate-order-date.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { CollectResult, NormalizedOrder } from './types';

export interface CollectOptions {
  /** 是否采集联盟点击（PM/LH/RW 随订单区间；LB 仅 endDate 单日，历史请导入校准） */
  includeClicks?: boolean;
}

export interface CollectResultWithPmMeta extends CollectResult {
  pmApi?: {
    apiListRows: number;
    orderCount: number;
    totalCommission: number;
  };
  lhApi?: {
    apiListRows: number;
    orderCount: number;
    totalCommission: number;
  };
  lbApi?: {
    apiListRows: number;
    orderCount: number;
    totalCommission: number;
  };
  rwApi?: {
    apiListRows: number;
    orderCount: number;
    totalCommission: number;
    apiSource: string;
    triedSources?: string[];
    sampleOrder?: { merchantId: string | null; orderDate: string; merchantName: string | null };
  };
  /** 区间内联盟后台点击汇总（刷量监控，不参与广告转化率） */
  pmClickTotal?: number;
  lhClickTotal?: number;
  lbClickTotal?: number;
  /** LB 商家点击经估算（该日 total_items>2000 时为 1） */
  lbClickEstimatedDays?: number;
  /** LB 点击实际采集日（= endDate；PM/LH 随订单区间） */
  lbClickCollectDate?: string;
  /** PM 联盟点击采集失败时的错误信息（订单仍会写入） */
  pmClickError?: string;
  rwClickTotal?: number;
  /** RW 联盟点击采集失败时的错误信息（订单仍会写入） */
  rwClickError?: string;
}

@Injectable()
export class CollectorsService {
  constructor(private readonly prisma: PrismaService) {}

  async collectForAccount(
    account: ChannelAccount & { platform: Platform },
    apiToken: string,
    startDate: string,
    endDate: string,
    onProgress?: (message: string) => Promise<void>,
    options: CollectOptions = {},
  ): Promise<CollectResultWithPmMeta> {
    if (!isCollectorImplemented(account.platform.code)) {
      throw new BadRequestException(
        collectorNotReadyMessage(account.platform.name, account.platform.code),
      );
    }

    await ensurePlatformStatusMappings(
      this.prisma,
      account.platformId,
      account.platform.code,
    );
    const mappings = await this.prisma.platformStatusMapping.findMany({
      where: { platformId: account.platformId },
    });

    let normalized: NormalizedOrder[] = [];
    let pmApi: CollectResultWithPmMeta['pmApi'];
    let lhApi: CollectResultWithPmMeta['lhApi'];
    let lbApi: CollectResultWithPmMeta['lbApi'];
    let rwApi: CollectResultWithPmMeta['rwApi'];
    let pmClickTotal: number | undefined;
    let lhClickTotal: number | undefined;
    let lbClickTotal: number | undefined;
    let lbClickEstimatedDays: number | undefined;
    let lbClickCollectDate: string | undefined;
    let pmClickError: string | undefined;
    let rwClickTotal: number | undefined;
    let rwClickError: string | undefined;

    /** LB 点击只采区间最后一天；PM/LH/RW API 随订单全区间采集 */
    const lbClickDay = endDate;

    switch (account.platform.code) {
      case 'partnermatic': {
        const raw = await fetchPartnerMaticOrders(apiToken, startDate, endDate);
        pmApi = summarizePmTransactionApi(raw);
        normalized = normalizePartnerMaticOrders(raw, mappings);

        if (options.includeClicks) {
          await onProgress?.('订单已拉取，正在采集 PM 联盟点击…');
          try {
            const clickAggs = await fetchPartnerMaticClicks(apiToken, startDate, endDate, async (p) => {
              await onProgress?.(
                `PM 联盟点击 ${p.slotIndex}/${p.totalSlots}，已汇总 ${p.clicksSoFar} 次`,
              );
            });
            await this.replaceClicksInRange(account.id, startDate, endDate);
            pmClickTotal = await this.persistClicks(account.id, clickAggs);
          } catch (clickErr) {
            pmClickError = clickErr instanceof Error ? clickErr.message : String(clickErr);
            await onProgress?.(`PM 联盟点击采集失败（订单仍会写入）: ${pmClickError}`);
          }
        }
        break;
      }
      case 'linkhaitao': {
        const raw = await fetchLinkHaitaoCommissions(
          apiToken,
          startDate,
          endDate,
          async (dayIndex, totalDays) => {
            await onProgress?.(`LH 佣金 ${dayIndex}/${totalDays} 天…`);
          },
        );
        lhApi = summarizeLhCommissionApi(raw);
        normalized = normalizeLinkHaitaoOrders(raw, mappings);

        if (options.includeClicks) {
          await onProgress?.('订单已拉取，正在采集 LH 联盟点击…');
          const slugToMid = buildLhMcidToMidMap(raw);
          const clickAggs = await fetchLinkHaitaoClicks(
            apiToken,
            startDate,
            endDate,
            slugToMid,
            async (p) => {
              await onProgress?.(
                `LH 点击 ${p.dayIndex}/${p.totalDays} 天，已汇总 ${p.clicksSoFar} 次`,
              );
            },
          );
          await this.replaceClicksInRange(account.id, startDate, endDate);
          lhClickTotal = await this.persistClicks(account.id, clickAggs);
        }
        break;
      }
      case 'linkbux': {
        const raw = await fetchLinkBuxOrders(
          apiToken,
          startDate,
          endDate,
          async (chunkIndex, totalChunks) => {
            await onProgress?.(`LB 订单 ${chunkIndex}/${totalChunks} 段…`);
          },
        );
        normalized = normalizeLinkBuxOrders(raw, mappings);
        const apiSum = summarizeLbTransactionApi(raw);
        const rangeSum = summarizeLbOrdersInRange(normalized, startDate, endDate);
        lbApi = {
          apiListRows: apiSum.apiListRows,
          orderCount: rangeSum.orderCount,
          totalCommission: rangeSum.totalCommission,
        };

        if (options.includeClicks) {
          lbClickCollectDate = lbClickDay;
          await onProgress?.(`订单已拉取，正在采集 LB 联盟点击（仅 ${lbClickDay}）…`);
          const slugToMid = buildLbMcidToMidMap(raw);
          const { aggs: clickAggs, accountClickTotal, estimatedMerchantDays } =
            await fetchLinkBuxClicks(
            apiToken,
            lbClickDay,
            lbClickDay,
            slugToMid,
            async (p) => {
              await onProgress?.(
                `LB 点击 ${p.slotIndex}/${p.totalSlots}，已汇总 ${p.clicksSoFar} 次`,
              );
            },
          );
          await this.replaceClicksInRange(account.id, lbClickDay, lbClickDay);
          await this.persistClicks(account.id, clickAggs);
          lbClickTotal = accountClickTotal;
          lbClickEstimatedDays = estimatedMerchantDays;
        }
        break;
      }
      case 'rewardoo': {
        const { rows, source, triedSources } = await fetchRewardooCommissions(
          apiToken,
          startDate,
          endDate,
          async (message) => {
            await onProgress?.(message);
          },
        );
        const range = { startDate, endDate };
        rwApi = { ...summarizeRwCommissionApi(rows, source, range), triedSources };
        normalized = normalizeRewardooOrders(rows, mappings, range);

        if (options.includeClicks) {
          await onProgress?.('订单已拉取，正在采集 RW 联盟点击（Performance 汇总）…');
          try {
            const clickAggs = await fetchRewardooClicks(
              apiToken,
              startDate,
              endDate,
              async (p) => {
                await onProgress?.(
                  `RW 联盟点击 ${p.slotIndex}/${p.totalSlots} 天，已汇总 ${p.clicksSoFar} 次`,
                );
              },
            );
            await this.replaceClicksInRange(account.id, startDate, endDate);
            rwClickTotal = await this.persistClicks(account.id, clickAggs);
          } catch (clickErr) {
            rwClickError = clickErr instanceof Error ? clickErr.message : String(clickErr);
            await onProgress?.(`RW 联盟点击采集失败（订单仍会写入）: ${rwClickError}`);
          }
        }
        break;
      }
      default:
        throw new BadRequestException(
          collectorNotReadyMessage(account.platform.name, account.platform.code),
        );
    }

    await this.replaceOrdersForCollect(account.id, normalized, startDate, endDate);
    const result = await this.persistOrders(account.id, normalized);
    return {
      ...result,
      pmApi,
      pmClickTotal,
      lhApi,
      lhClickTotal,
      lbApi,
      rwApi,
      lbClickTotal,
      lbClickEstimatedDays,
      lbClickCollectDate,
      pmClickError,
      rwClickTotal,
      rwClickError,
    };
  }

  /**
   * 按采集日期范围替换联盟点击日汇总（须在拉取成功后调用，避免拉取失败导致区间被清空）
   */
  private async replaceClicksInRange(
    channelAccountId: number,
    startDate: string,
    endDate: string,
  ) {
    await this.prisma.affiliateMerchantClickDaily.deleteMany({
      where: {
        channelAccountId,
        source: AffiliateClickSource.api,
        clickDate: buildOrderDateRangeFilter(startDate, endDate),
      },
    });
  }

  /**
   * 写入 PM click_report 按商家+日汇总
   */
  private async persistClicks(
    channelAccountId: number,
    clicks: PmMerchantClickAgg[],
  ): Promise<number> {
    let total = 0;
    for (const c of clicks) {
      const clickDate = new Date(c.clickDate);
      const existing = await this.prisma.affiliateMerchantClickDaily.findUnique({
        where: {
          channelAccountId_merchantId_clickDate: {
            channelAccountId,
            merchantId: c.merchantId,
            clickDate,
          },
        },
      });
      if (existing?.source === AffiliateClickSource.manual) {
        continue;
      }

      await this.prisma.affiliateMerchantClickDaily.upsert({
        where: {
          channelAccountId_merchantId_clickDate: {
            channelAccountId,
            merchantId: c.merchantId,
            clickDate,
          },
        },
        create: {
          channelAccountId,
          merchantId: c.merchantId,
          merchantName: c.merchantName,
          clickDate,
          clicks: c.clicks,
          source: AffiliateClickSource.api,
        },
        update: {
          merchantName: c.merchantName,
          clicks: c.clicks,
          source: AffiliateClickSource.api,
        },
      });
      total += c.clicks;
    }
    return total;
  }

  /**
   * 采集前清理：删区间内订单 + 删本批 externalOrderId（修正 orderDate / 时区后避免 skipDuplicates 漏写）
   */
  private async replaceOrdersForCollect(
    channelAccountId: number,
    orders: NormalizedOrder[],
    startDate: string,
    endDate: string,
  ) {
    const externalIds = [...new Set(orders.map((o) => o.externalOrderId))];
    await this.prisma.affiliateOrder.deleteMany({
      where: {
        channelAccountId,
        OR: [
          {
            orderDate: {
              gte: new Date(`${startDate}T00:00:00.000Z`),
              lte: new Date(`${endDate}T23:59:59.999Z`),
            },
          },
          ...(externalIds.length > 0
            ? [{ externalOrderId: { in: externalIds } }]
            : []),
        ],
      },
    });
  }

  private async persistOrders(
    channelAccountId: number,
    orders: NormalizedOrder[],
  ): Promise<CollectResult> {
    if (!orders.length) {
      return { fetched: 0, inserted: 0, updated: 0 };
    }

    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < orders.length; i += batchSize) {
      const chunk = orders.slice(i, i + batchSize);
      const result = await this.prisma.affiliateOrder.createMany({
        data: chunk.map((o) => ({
          channelAccountId,
          externalOrderId: o.externalOrderId,
          merchantId: o.merchantId,
          merchantName: o.merchantName,
          merchantSlug: o.merchantSlug,
          productId: o.productId,
          orderAmount: o.orderAmount,
          commission: o.commission,
          currency: o.currency,
          rawStatus: o.rawStatus,
          normalizedStatus: o.normalizedStatus,
          orderDate: o.orderDate,
          rawPayload: o.rawPayload as object,
          collectedAt: new Date(),
        })),
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return { fetched: orders.length, inserted, updated: 0 };
  }
}
