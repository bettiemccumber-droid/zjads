import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MerchantOpsListType = 'violation' | 'recommend';

export interface MerchantOpsListRowInput {
  platformCode: string;
  mid: string;
  name?: string;
  countryCode?: string;
  merchantUrl?: string;
  category?: string;
  note?: string;
}

/**
 * 违规商家 / 推荐商家运营名单。管理员整表替换，员工只读。
 */
@Injectable()
export class MerchantOpsListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 员工与管理员都可查看本组织名单。
   */
  async list(organizationId: number, listType: MerchantOpsListType) {
    this.assertType(listType);
    const rows = await this.prisma.merchantOpsListItem.findMany({
      where: { organizationId, listType },
      orderBy: [{ platformCode: 'asc' }, { name: 'asc' }, { mid: 'asc' }],
    });
    return {
      listType,
      total: rows.length,
      items: rows.map((row) => this.toView(row)),
    };
  }

  /**
   * 管理员整表替换某一类名单。
   */
  async replace(organizationId: number, listType: MerchantOpsListType, rows: MerchantOpsListRowInput[]) {
    this.assertType(listType);
    if (!Array.isArray(rows)) throw new BadRequestException('请上传商家行');
    if (rows.length > 5000) throw new BadRequestException('单次最多 5000 行');

    const cleaned: Array<{
      organizationId: number;
      listType: string;
      platformCode: string;
      mid: string;
      name: string;
      countryCode: string;
      merchantUrl: string;
      category: string;
      note: string;
    }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const platformCode = String(row.platformCode ?? '')
        .trim()
        .toLowerCase()
        .slice(0, 50);
      const mid = String(row.mid ?? '').trim().slice(0, 64);
      if (!platformCode || !mid) continue;
      const key = `${platformCode}:${mid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push({
        organizationId,
        listType,
        platformCode,
        mid,
        name: String(row.name ?? '').trim().slice(0, 255),
        countryCode: String(row.countryCode ?? '').trim().toUpperCase().slice(0, 32),
        merchantUrl: String(row.merchantUrl ?? '').trim().slice(0, 2048),
        category: String(row.category ?? '').trim().slice(0, 255),
        note: String(row.note ?? '').trim().slice(0, 500),
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.merchantOpsListItem.deleteMany({ where: { organizationId, listType } });
      if (cleaned.length === 0) return;
      await tx.merchantOpsListItem.createMany({ data: cleaned });
    });

    return this.list(organizationId, listType);
  }

  private assertType(listType: string): asserts listType is MerchantOpsListType {
    if (listType !== 'violation' && listType !== 'recommend') {
      throw new BadRequestException('名单类型只能是 violation 或 recommend');
    }
  }

  private toView(row: {
    id: number;
    listType: string;
    platformCode: string;
    mid: string;
    name: string;
    countryCode: string;
    merchantUrl: string;
    category: string;
    note: string;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      listType: row.listType,
      platformCode: row.platformCode,
      mid: row.mid,
      name: row.name,
      countryCode: row.countryCode,
      merchantUrl: row.merchantUrl,
      category: row.category,
      note: row.note,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
