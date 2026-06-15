import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class AdSourcesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser) {
    return this.prisma.adDataSource.findMany({
      where: { ownerUserId: user.id },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async create(user: AuthUser, dto: CreateAdDataSourceDto) {
    if (user.role === UserRole.VIEWER) {
      throw new BadRequestException('只读账号无法配置广告数据源');
    }
    const sheetId = extractSheetId(dto.sheetUrl);
    if (!sheetId) {
      throw new BadRequestException('无效的 Google Sheet URL');
    }

    return this.prisma.adDataSource.create({
      data: {
        ownerUserId: user.id,
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
      where: { id, ownerUserId: user.id },
    });
    if (!row) throw new NotFoundException('数据源不存在');
    await this.prisma.adDataSource.delete({ where: { id } });
    if (purgeImported) {
      await this.purgeImportedCampaignData(user, {});
    }
    return { deleted: true, purged: purgeImported };
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
    return {
      upserted,
      dateFrom: dates[0],
      dateTo: dates[dates.length - 1],
      campaignCount: new Set(rows.map((r) => r.campaignId)).size,
    };
  }
}
