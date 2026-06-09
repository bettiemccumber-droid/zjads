import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AffiliateClickSource } from '@prisma/client';
import { AuthUser, isAdmin } from '../common/ownership.util';
import { PrismaService } from '../prisma/prisma.service';

/** 手动导入的单条商家×日点击 */
export interface ImportAffiliateClickRow {
  merchantId: string;
  clickDate: string;
  clicks: number;
  merchantName?: string;
}

export interface ImportAffiliateClicksResult {
  imported: number;
  totalClicks: number;
  minDate: string | null;
  maxDate: string | null;
}

@Injectable()
export class AffiliateClicksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 手动导入/校准联盟点击（覆盖同账号同商家同日，标记为 manual，后续 API 同步不覆盖）
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
    let minDate: string | null = null;
    let maxDate: string | null = null;

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const merchantId = String(row.merchantId ?? '').trim();
      const clickDate = String(row.clickDate ?? '').trim();
      const clicks = Number(row.clicks);

      if (!merchantId) {
        throw new BadRequestException(`第 ${i + 1} 行：merchantId 不能为空`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(clickDate)) {
        throw new BadRequestException(`第 ${i + 1} 行：clickDate 须为 YYYY-MM-DD`);
      }
      if (!Number.isFinite(clicks) || clicks < 0 || !Number.isInteger(clicks)) {
        throw new BadRequestException(`第 ${i + 1} 行：clicks 须为非负整数`);
      }

      await this.prisma.affiliateMerchantClickDaily.upsert({
        where: {
          channelAccountId_merchantId_clickDate: {
            channelAccountId,
            merchantId,
            clickDate: new Date(clickDate),
          },
        },
        create: {
          channelAccountId,
          merchantId,
          merchantName: String(row.merchantName ?? '').trim(),
          clickDate: new Date(clickDate),
          clicks,
          source: AffiliateClickSource.manual,
        },
        update: {
          merchantName: String(row.merchantName ?? '').trim(),
          clicks,
          source: AffiliateClickSource.manual,
        },
      });

      imported += 1;
      totalClicks += clicks;
      if (!minDate || clickDate < minDate) minDate = clickDate;
      if (!maxDate || clickDate > maxDate) maxDate = clickDate;
    }

    return { imported, totalClicks, minDate, maxDate };
  }
}
