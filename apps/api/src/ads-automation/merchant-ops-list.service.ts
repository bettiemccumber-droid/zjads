import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MerchantOpsListType = 'violation' | 'recommend';

export type MerchantOpsImportMode = 'merge' | 'replace_platforms' | 'replace_all';

export interface MerchantOpsListRowInput {
  platformCode: string;
  mid: string;
  name?: string;
  countryCode?: string;
  merchantUrl?: string;
  category?: string;
  note?: string;
}

/** 与前端 opsPlatform 保持一致：chuizhan_cg → collabglow 等 */
const PLATFORM_ALIASES: Record<string, string> = {
  linkhaitao: 'linkhaitao',
  lh: 'linkhaitao',
  rewardoo: 'rewardoo',
  rewardme: 'rewardoo',
  rw: 'rewardoo',
  linkbux: 'linkbux',
  linkbuy: 'linkbux',
  lb: 'linkbux',
  partnermatic: 'partnermatic',
  pm: 'partnermatic',
  shoplooks: 'shoplooks',
  shoplookz: 'shoplooks',
  bsh: 'shoplooks',
  collabglow: 'collabglow',
  cg: 'collabglow',
  ultrainfluence: 'ultrainfluence',
  ui: 'ultrainfluence',
  famesta: 'famesta',
  fs: 'famesta',
  chuizhan_lh: 'linkhaitao',
  chuizhanlh: 'linkhaitao',
  chuizhan_rw: 'rewardoo',
  chuizhanrw: 'rewardoo',
  chuizhan_pm: 'partnermatic',
  chuizhanpm: 'partnermatic',
  chuizhan_bsh: 'shoplooks',
  chuizhanbsh: 'shoplooks',
  chuizhan_cg: 'collabglow',
  chuizhancg: 'collabglow',
  chuizhan_ui: 'ultrainfluence',
  chuizhanui: 'ultrainfluence',
  chuizhan_fs: 'famesta',
  chuizhanfs: 'famesta',
};

/**
 * 违规商家 / 推荐商家运营名单。可按平台多次上传合并，员工只读。
 */
@Injectable()
export class MerchantOpsListService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 员工与管理员都可查看本组织名单。
   */
  async list(organizationId: number, listType: MerchantOpsListType) {
    this.assertType(listType);
    await this.remapLegacyPlatformCodes_(organizationId, listType);
    const rows = await this.prisma.merchantOpsListItem.findMany({
      where: { organizationId, listType },
      orderBy: [{ platformCode: 'asc' }, { name: 'asc' }, { mid: 'asc' }],
    });
    const platformCounts: Record<string, number> = {};
    for (const row of rows) {
      platformCounts[row.platformCode] = (platformCounts[row.platformCode] ?? 0) + 1;
    }
    return {
      listType,
      total: rows.length,
      platformCounts,
      items: rows.map((row) => this.toView(row)),
    };
  }

  /**
   * 管理员导入名单。
   * - merge：按平台+MID 写入或更新，不动其他行（多平台分次上传用这个）
   * - replace_platforms：只覆盖本次文件里出现的平台，其他平台保留
   * - replace_all：整表清空再写入
   */
  async importRows(
    organizationId: number,
    listType: MerchantOpsListType,
    rows: MerchantOpsListRowInput[],
    mode: MerchantOpsImportMode = 'merge',
  ) {
    this.assertType(listType);
    if (!Array.isArray(rows)) throw new BadRequestException('请上传商家行');
    if (rows.length > 20000) throw new BadRequestException('单次最多 20000 行');
    if (mode !== 'merge' && mode !== 'replace_platforms' && mode !== 'replace_all') {
      throw new BadRequestException('导入模式无效');
    }

    const cleaned = this.cleanRows(organizationId, listType, rows);
    if (cleaned.length === 0) throw new BadRequestException('没有有效商家行（需要平台 + MID）');

    const platforms = [...new Set(cleaned.map((row) => row.platformCode))];

    await this.prisma.$transaction(async (tx) => {
      if (mode === 'replace_all') {
        await tx.merchantOpsListItem.deleteMany({ where: { organizationId, listType } });
        await tx.merchantOpsListItem.createMany({ data: cleaned });
        return;
      }

      if (mode === 'replace_platforms') {
        await tx.merchantOpsListItem.deleteMany({
          where: { organizationId, listType, platformCode: { in: platforms } },
        });
        await tx.merchantOpsListItem.createMany({ data: cleaned });
        return;
      }

      for (const row of cleaned) {
        await tx.merchantOpsListItem.upsert({
          where: {
            organizationId_listType_platformCode_mid: {
              organizationId: row.organizationId,
              listType: row.listType,
              platformCode: row.platformCode,
              mid: row.mid,
            },
          },
          create: row,
          update: {
            name: row.name,
            countryCode: row.countryCode,
            merchantUrl: row.merchantUrl,
            category: row.category,
            note: row.note,
          },
        });
      }
    });

    const result = await this.list(organizationId, listType);
    return {
      ...result,
      imported: cleaned.length,
      platforms,
      mode,
    };
  }

  /**
   * 清空某一类名单，或只清某个平台。
   */
  async clear(organizationId: number, listType: MerchantOpsListType, platformCode?: string) {
    this.assertType(listType);
    const platform = platformCode?.trim().toLowerCase();
    await this.prisma.merchantOpsListItem.deleteMany({
      where: {
        organizationId,
        listType,
        ...(platform ? { platformCode: platform } : {}),
      },
    });
    return this.list(organizationId, listType);
  }

  private cleanRows(organizationId: number, listType: string, rows: MerchantOpsListRowInput[]) {
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
      const platformCode = this.normalizePlatform_(String(row.platformCode ?? ''));
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
    return cleaned;
  }

  private assertType(listType: string): asserts listType is MerchantOpsListType {
    if (listType !== 'violation' && listType !== 'recommend') {
      throw new BadRequestException('名单类型只能是 violation 或 recommend');
    }
  }

  private normalizePlatform_(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return '';
    const key = trimmed.toLowerCase().replace(/[\s_\-]/g, '');
    if (PLATFORM_ALIASES[key]) return PLATFORM_ALIASES[key];
    const withUnderscore = trimmed.toLowerCase().replace(/\s+/g, '_');
    if (PLATFORM_ALIASES[withUnderscore]) return PLATFORM_ALIASES[withUnderscore];
    const lower = trimmed.toLowerCase();
    if (PLATFORM_ALIASES[lower]) return PLATFORM_ALIASES[lower];
    return lower.slice(0, 50);
  }

  /**
   * 把历史导入的 chuizhan_cg 等改成 collabglow；与已有正式码冲突时删掉旧行。
   */
  private async remapLegacyPlatformCodes_(organizationId: number, listType: MerchantOpsListType) {
    const legacy = await this.prisma.merchantOpsListItem.findMany({
      where: {
        organizationId,
        listType,
        OR: [
          { platformCode: { startsWith: 'chuizhan' } },
          { platformCode: { in: ['cg', 'ui', 'fs', 'lh', 'rw', 'pm', 'lb', 'bsh'] } },
        ],
      },
      select: { id: true, platformCode: true, mid: true },
    });
    if (legacy.length === 0) return;

    for (const row of legacy) {
      const next = this.normalizePlatform_(row.platformCode);
      if (!next || next === row.platformCode) continue;
      const conflict = await this.prisma.merchantOpsListItem.findUnique({
        where: {
          organizationId_listType_platformCode_mid: {
            organizationId,
            listType,
            platformCode: next,
            mid: row.mid,
          },
        },
        select: { id: true },
      });
      if (conflict) {
        await this.prisma.merchantOpsListItem.delete({ where: { id: row.id } });
        continue;
      }
      await this.prisma.merchantOpsListItem.update({
        where: { id: row.id },
        data: { platformCode: next },
      });
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
    createdAt: Date;
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
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
