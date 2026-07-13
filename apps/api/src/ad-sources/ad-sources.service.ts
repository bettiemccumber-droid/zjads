import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import axios from 'axios';
import { UserRole } from '@prisma/client';
import { AuthUser, isAdmin, resolveOwnerUserId } from '../common/ownership.util';
import { buildOrderDateRangeFilter } from '../common/order-date-range.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildSheetCsvUrl,
  extractSheetId,
  parseAdSheetCsv,
} from './sheet-parser.util';

export interface CreateAdDataSourceDto {
  name: string;
  sheetUrl: string;
  mainTab?: string;
  description?: string;
}

/** 单个 Sheet 导入结果 */
export interface SheetImportItemResult {
  sourceId: number;
  sourceName: string;
  ok: boolean;
  upserted?: number;
  dateFrom?: string;
  dateTo?: string;
  campaignCount?: number;
  coverageWarning?: string;
  message?: string;
}

/** 某员工全部 Sheet 批量导入汇总 */
export interface OwnerSheetBatchImportResult {
  sheetCount: number;
  success: number;
  failed: number;
  totalUpserted: number;
  dateFrom: string;
  dateTo: string;
  results: SheetImportItemResult[];
}

/** 采集任务完成后自动导入 Sheet 的返回 */
export type OwnerSheetAutoImportResult =
  | { skipped: true; reason: 'no_ad_source' }
  | { skipped: true; reason: 'import_failed'; message: string }
  | ({ skipped: false } & OwnerSheetBatchImportResult);

@Injectable()
export class AdSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, queryUserId?: number) {
    const ownerUserId = this.resolveOwnerUserId(user, queryUserId);
    return this.prisma.adDataSource.findMany({
      where: { ownerUserId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: CreateAdDataSourceDto, queryUserId?: number) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法配置广告数据源');
    }
    const ownerUserId = this.resolveOwnerUserId(user, queryUserId);
    const sheetId = extractSheetId(dto.sheetUrl);
    if (!sheetId) {
      throw new BadRequestException('无效的 Google Sheet URL');
    }

    return this.prisma.adDataSource.create({
      data: {
        ownerUserId,
        name: dto.name,
        sheetUrl: dto.sheetUrl.trim(),
        sheetId,
        mainTab: dto.mainTab?.trim() || 'raw_daily_report',
        description: dto.description,
      },
    });
  }

  async remove(user: AuthUser, id: number, purgeImported = false) {
    const row = await this.prisma.adDataSource.findFirst({
      where: {
        id,
        ...(user.role === UserRole.ADMIN ? {} : { ownerUserId: user.id }),
      },
    });
    if (!row) throw new NotFoundException('数据源不存在');
    await this.prisma.adDataSource.delete({ where: { id } });
    if (purgeImported) {
      await this.purgeImportedCampaignData(user, { userId: row.ownerUserId });
    }
    return { deleted: true, purged: purgeImported };
  }

  private resolveOwnerUserId(user: AuthUser, queryUserId?: number): number {
    if (queryUserId != null) {
      if (user.role !== UserRole.ADMIN && queryUserId !== user.id) {
        throw new ForbiddenException('无权查看其他员工的广告数据源');
      }
      return queryUserId;
    }
    return user.id;
  }

  /**
   * 清空已导入的 Google Sheet 广告日数据（误导入 Sheet 后使用）
   */
  async purgeImportedCampaignData(
    user: AuthUser,
    opts: { startDate?: string; endDate?: string; userId?: number },
  ) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法清空广告数据');
    }

    const ownerUserId =
      user.role === UserRole.ADMIN && opts.userId != null
        ? opts.userId
        : resolveOwnerUserId(user, opts.userId);

    if (opts.userId != null && user.role !== UserRole.ADMIN && opts.userId !== user.id) {
      throw new BadRequestException('无权操作其他员工的数据');
    }

    const dateRange = buildOrderDateRangeFilter(opts.startDate, opts.endDate);
    const result = await this.prisma.adCampaignDaily.deleteMany({
      where: {
        ownerUserId,
        ...(dateRange ? { date: dateRange } : {}),
      },
    });
    return {
      deleted: result.count,
      ownerUserId,
      startDate: opts.startDate ?? null,
      endDate: opts.endDate ?? null,
    };
  }

  /**
   * 按员工 ID 导入全部已启用 Sheet（采集任务 / 管理员批量导入）
   */
  async importBatchForOwnerId(
    ownerUserId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<OwnerSheetBatchImportResult | null> {
    return this.importAllSourcesForOwnerId(ownerUserId, startDate, endDate);
  }

  /**
   * 按员工自动导入全部已绑定 Sheet（采集任务完成后调用）
   */
  async importForOwner(
    ownerUserId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<OwnerSheetAutoImportResult> {
    const batch = await this.importAllSourcesForOwnerId(ownerUserId, startDate, endDate);
    if (!batch) {
      return { skipped: true, reason: 'no_ad_source' };
    }
    if (batch.success === 0) {
      const failedNames = batch.results
        .filter((r) => !r.ok)
        .map((r) => `${r.sourceName}：${r.message ?? '未知错误'}`)
        .join('；');
      return { skipped: true, reason: 'import_failed', message: failedNames || '全部 Sheet 导入失败' };
    }
    return { skipped: false, ...batch };
  }

  /**
   * 批量导入某员工全部已启用 Sheet
   */
  async importAllForOwner(
    user: AuthUser,
    startDate?: string,
    endDate?: string,
    queryUserId?: number,
  ) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法导入广告数据');
    }

    const ownerUserId = this.resolveOwnerUserId(user, queryUserId);
    const batch = await this.importAllSourcesForOwnerId(ownerUserId, startDate, endDate);
    if (!batch) {
      throw new BadRequestException('暂无广告数据源，请先添加 Sheet');
    }

    return batch;
  }

  /**
   * 生成采集任务完成后的 Sheet 导入说明文案
   */
  formatOwnerSheetImportNote(
    result: OwnerSheetAutoImportResult,
    syncStart: string,
    syncEnd: string,
  ): string | null {
    if (result.skipped) {
      if (result.reason === 'no_ad_source') {
        return '未配置广告数据源，已跳过 Sheet 导入';
      }
      return `Sheet 导入失败：${result.message}`;
    }

    const { sheetCount, success, failed, totalUpserted, dateFrom, dateTo, results } = result;
    let note =
      sheetCount === 1
        ? `Sheet 已导入 ${totalUpserted} 行（${syncStart}~${syncEnd}，Sheet 实际 ${dateFrom}~${dateTo}）`
        : `Sheet 已导入 ${success}/${sheetCount} 个数据源共 ${totalUpserted} 行（${syncStart}~${syncEnd}，实际 ${dateFrom}~${dateTo}）`;

    if (failed > 0) {
      const failedNames = results.filter((r) => !r.ok).map((r) => r.sourceName).join('、');
      note += `；失败 ${failed}（${failedNames}）`;
    }

    const warnings = results
      .filter((r) => r.ok && r.coverageWarning)
      .map((r) => (sheetCount === 1 ? r.coverageWarning! : `${r.sourceName}：${r.coverageWarning}`));
    if (warnings.length) {
      note += `；⚠ ${warnings.join('；')}`;
    }

    return note;
  }

  /**
   * 依次导入某员工全部已启用 Sheet
   */
  private async importAllSourcesForOwnerId(
    ownerUserId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<OwnerSheetBatchImportResult | null> {
    const sources = await this.prisma.adDataSource.findMany({
      where: { ownerUserId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!sources.length) {
      return null;
    }

    const results: SheetImportItemResult[] = [];

    for (const source of sources) {
      try {
        const r = await this.importSourceData(source, startDate, endDate);
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: true,
          upserted: r.upserted,
          dateFrom: r.dateFrom,
          dateTo: r.dateTo,
          campaignCount: r.campaignCount,
          coverageWarning: r.coverageWarning,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          ok: false,
          message,
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const totalUpserted = results.reduce((sum, r) => sum + (r.upserted ?? 0), 0);
    const okResults = results.filter((r) => r.ok && r.dateFrom && r.dateTo);
    const dateFrom = okResults.length
      ? okResults.map((r) => r.dateFrom!).sort()[0]
      : startDate ?? '';
    const dateTo = okResults.length
      ? okResults.map((r) => r.dateTo!).sort().slice(-1)[0]
      : endDate ?? '';

    return {
      sheetCount: sources.length,
      success,
      failed,
      totalUpserted,
      dateFrom,
      dateTo,
      results,
    };
  }

  /**
   * 从 Google Sheet 拉取 CSV 并写入 ad_campaign_daily
   */
  async importFromSource(user: AuthUser, sourceId: number, startDate?: string, endDate?: string) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法导入广告数据');
    }

    const source = await this.prisma.adDataSource.findFirst({
      where: {
        id: sourceId,
        isActive: true,
        ...(user.role === UserRole.ADMIN ? {} : { ownerUserId: user.id }),
      },
    });
    if (!source) throw new NotFoundException('数据源不存在或未启用');

    return this.importSourceData(source, startDate, endDate);
  }

  /**
   * 拉取并写入单个 Sheet 数据源
   */
  private async importSourceData(
    source: { id: number; ownerUserId: number; sheetId: string; mainTab: string },
    startDate?: string,
    endDate?: string,
  ) {
    const ownerUserId = source.ownerUserId;

    const csvUrl = buildSheetCsvUrl(source.sheetId, source.mainTab);
    let csvText: string;
    try {
      const res = await axios.get<string>(csvUrl, {
        timeout: 120000,
        responseType: 'text',
        headers: { 'User-Agent': 'ZJADS/1.0' },
      });
      csvText = res.data;
    } catch {
      throw new BadRequestException(
        '无法拉取 Sheet，请确认表格已「知道链接的任何人可查看」',
      );
    }

    let rows = parseAdSheetCsv(csvText);
    const sheetDateFrom = rows.length ? rows.map((r) => r.date).sort()[0] : '';
    const sheetDateTo = rows.length ? rows.map((r) => r.date).sort().slice(-1)[0] : '';

    if (startDate) {
      rows = rows.filter((r) => r.date >= startDate);
    }
    if (endDate) {
      rows = rows.filter((r) => r.date <= endDate);
    }
    if (!rows.length) {
      const hint =
        sheetDateFrom && sheetDateTo
          ? `Sheet 现有数据约为 ${sheetDateFrom} ~ ${sheetDateTo}，请扩大导入日期或改用全量导入。`
          : '请检查表名与表头是否正确。';
      throw new BadRequestException(`所选日期区间内无广告数据。${hint}`);
    }

    const datesInBatch = [...new Set(rows.map((r) => r.date))].sort();
    const customerIdsInBatch = [...new Set(rows.map((r) => r.customerId))];

    /** 仅清空本 Sheet 涉及日期与子账号，避免多 Sheet 批量导入时互相覆盖 */
    for (const dateStr of datesInBatch) {
      await this.prisma.adCampaignDaily.deleteMany({
        where: {
          ownerUserId,
          date: buildOrderDateRangeFilter(dateStr, dateStr),
          customerId: { in: customerIdsInBatch },
        },
      });
    }

    let upserted = 0;
    for (const row of rows) {
      await this.prisma.adCampaignDaily.upsert({
        where: {
          ownerUserId_date_customerId_campaignId: {
            ownerUserId,
            date: new Date(row.date),
            customerId: row.customerId,
            campaignId: row.campaignId,
          },
        },
        create: {
          ownerUserId,
          date: new Date(row.date),
          customerId: row.customerId,
          campaignId: row.campaignId,
          campaignName: row.campaignName,
          campaignStatus: row.campaignStatus,
          affiliateAlias: row.affiliateAlias,
          merchantId: row.merchantId,
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.cost,
          campaignBudget: row.campaignBudget,
          searchBudgetLostIs: row.searchBudgetLostIs,
          searchRankLostIs: row.searchRankLostIs,
          avgCpc: row.avgCpc,
          maxCpc: row.maxCpc,
          currency: row.currency,
        },
        update: {
          campaignName: row.campaignName,
          campaignStatus: row.campaignStatus,
          affiliateAlias: row.affiliateAlias,
          merchantId: row.merchantId,
          impressions: row.impressions,
          clicks: row.clicks,
          cost: row.cost,
          campaignBudget: row.campaignBudget,
          searchBudgetLostIs: row.searchBudgetLostIs,
          searchRankLostIs: row.searchRankLostIs,
          avgCpc: row.avgCpc,
          maxCpc: row.maxCpc,
          currency: row.currency,
        },
      });
      upserted += 1;
    }

    await this.prisma.adDataSource.update({
      where: { id: source.id },
      data: { updatedAt: new Date() },
    });

    const dates = rows.map((r) => r.date).sort();
    const dateFrom = dates[0];
    const dateTo = dates[dates.length - 1];
    const requestedEnd = endDate ?? dateTo;
    const coverageWarning =
      endDate && dateTo < endDate
        ? `Sheet 实际仅到 ${dateTo}（表内最新 ${sheetDateTo || dateTo}），早于请求 ${endDate}，末段按天广告费可能缺失，请先跑 MCC 脚本再导入`
        : undefined;

    return {
      upserted,
      dateFrom,
      dateTo,
      requestedEnd,
      coverageWarning,
      sheetDateFrom,
      sheetDateTo,
      campaignCount: new Set(rows.map((r) => r.campaignId)).size,
    };
  }
}
