import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AffiliateClickSource } from '@prisma/client';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';

/** 手动导入的单条商家×日 Performance 校准（点击 / 订单数；不覆盖佣金） */
export interface ImportAffiliateClickRow {
  merchantId: string;
  clickDate: string;
  clicks: number;
  merchantName?: string;
  /** RW 等：Performance 看板 Orders（可选，有则写入 performanceOrders） */
  performanceOrders?: number;
}

export interface ImportAffiliateClicksResult {
  imported: number;
  totalClicks: number;
  totalOrders: number;
  minDate: string | null;
  maxDate: string | null;
}

@Injectable()
export class AffiliateClicksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 手动导入 Performance 校准（LB 仅点击；RW 可填点击 + 订单数；不改 commission）
   * 标记 manual：采集时保留导入的 clicks；若导入含订单数则订单也保留，否则由采集补写；佣金随采集更新
   */
  async importManualClicks(
    user: AuthUser,
    channelAccountId: number,
    rows: ImportAffiliateClickRow[],
  ): Promise<ImportAffiliateClicksResult> {
    const account = await this.prisma.channelAccount.findUnique({
      where: { id: channelAccountId },
      include: { platform: true },
    });
    if (!account) throw new NotFoundException('渠道账号不存在');
    if (account.ownerUserId !== user.id && !isAdmin(user)) {
      throw new ForbiddenException('无权操作此账号');
    }
    if (!rows.length) throw new BadRequestException('导入数据为空');

    let imported = 0;
    let totalClicks = 0;
    let totalOrders = 0;
    let minDate: string | null = null;
    let maxDate: string | null = null;

    const platformCode = account.platform.code;
    /** LB 校准导入仅写点击；RW 可写点击 + 订单数 */
    const allowOrdersImport = platformCode === 'rewardoo';

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const merchantId = String(row.merchantId ?? '').trim();
      const clickDate = String(row.clickDate ?? '').trim();
      const clicks = Number(row.clicks ?? 0);
      const hasOrders =
        allowOrdersImport &&
        row.performanceOrders !== undefined &&
        row.performanceOrders !== null;
      const performanceOrders = hasOrders ? Number(row.performanceOrders) : undefined;

      if (!merchantId) {
        throw new BadRequestException(`第 ${i + 1} 行：merchantId 不能为空`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clickDate)) {
        throw new BadRequestException(`第 ${i + 1} 行：clickDate 须为 YYYY-MM-DD`);
      }
      if (!Number.isFinite(clicks) || clicks < 0 || !Number.isInteger(clicks)) {
        throw new BadRequestException(`第 ${i + 1} 行：clicks 须为非负整数`);
      }
      if (
        hasOrders &&
        (!Number.isFinite(performanceOrders!) ||
          performanceOrders! < 0 ||
          !Number.isInteger(performanceOrders!))
      ) {
        throw new BadRequestException(`第 ${i + 1} 行：orders 须为非负整数`);
      }
      if (clicks === 0 && (!hasOrders || performanceOrders === 0)) {
        throw new BadRequestException(`第 ${i + 1} 行：clicks 与 orders 不能同时为 0`);
      }

      const merchantName = String(row.merchantName ?? '').trim();
      const clickDateObj = new Date(clickDate);

      const existing = await this.prisma.affiliateMerchantClickDaily.findUnique({
        where: {
          channelAccountId_merchantId_clickDate: {
            channelAccountId,
            merchantId,
            clickDate: clickDateObj,
          },
        },
      });

      if (existing) {
        await this.prisma.affiliateMerchantClickDaily.update({
          where: {
            channelAccountId_merchantId_clickDate: {
              channelAccountId,
              merchantId,
              clickDate: clickDateObj,
            },
          },
          data: {
            merchantName: merchantName || existing.merchantName,
            clicks,
            ...(hasOrders ? { performanceOrders: performanceOrders! } : {}),
            source: AffiliateClickSource.manual,
          },
        });
      } else {
        await this.prisma.affiliateMerchantClickDaily.create({
          data: {
            channelAccountId,
            merchantId,
            merchantName,
            clickDate: clickDateObj,
            clicks,
            performanceOrders: hasOrders ? performanceOrders! : 0,
            performanceCommission: 0,
            source: AffiliateClickSource.manual,
          },
        });
      }

      imported += 1;
      totalClicks += clicks;
      if (hasOrders) totalOrders += performanceOrders!;
      if (!minDate || clickDate < minDate) minDate = clickDate;
      if (!maxDate || clickDate > maxDate) maxDate = clickDate;
    }

    return { imported, totalClicks, totalOrders, minDate, maxDate };
  }
}
