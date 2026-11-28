import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  getPromoNodeDefinition,
  listPromoNodeDefinitions,
  listUpcomingPromoNodes,
} from './promo-node.calendar';

export type MerchantOpsListType = 'violation' | 'recommend' | 'node';

export type MerchantOpsImportMode = 'merge' | 'replace_platforms' | 'replace_all';

export interface MerchantOpsListRowInput {
  platformCode: string;
  mid: string;
  name?: string;
  countryCode?: string;
  merchantUrl?: string;
  category?: string;
  note?: string;
  epc?: string;
  commissionRate?: string;
  avgOrderValue?: string;
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
  brandsparkhub: 'brandsparkhub',
  bsp: 'brandsparkhub',
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
 * 违规商家 / 推荐商家 / 节日节点推荐名单。可按平台多次上传合并，员工只读。
 */
@Injectable()
export class MerchantOpsListService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 启动时补齐节点推荐字段（避免 prisma db push 被无关外键挡住）。
   */
  async onModuleInit() {
    try {
      await this.ensureNodeSchema_();
    } catch (error) {
      console.error(
        '[merchant-ops-list] ensure node schema failed',
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * 员工与管理员都可查看本组织名单。
   */
  async list(organizationId: number, listType: MerchantOpsListType, nodeKey = '') {
    this.assertType(listType);
    const key = listType === 'node' ? this.requireNodeKey_(nodeKey) : '';
    await this.remapLegacyPlatformCodes_(organizationId, listType, key);
    const rows = await this.prisma.merchantOpsListItem.findMany({
      where: { organizationId, listType, nodeKey: key },
      orderBy: [{ platformCode: 'asc' }, { name: 'asc' }, { mid: 'asc' }],
    });
    const platformCounts: Record<string, number> = {};
    for (const row of rows) {
      platformCounts[row.platformCode] = (platformCounts[row.platformCode] ?? 0) + 1;
    }
    return {
      listType,
      nodeKey: key,
      total: rows.length,
      platformCounts,
      items: rows.map((row) => this.toView(row)),
    };
  }

  /**
   * 即将到来的促销节点 + 各节点已上传名单数量。
   */
  async listPromoNodes(organizationId: number) {
    const upcoming = listUpcomingPromoNodes();
    const counts = await this.prisma.merchantOpsListItem.groupBy({
      by: ['nodeKey'],
      where: { organizationId, listType: 'node' },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((row) => [row.nodeKey, row._count._all]));
    const nodes = upcoming.map((node) => ({
      ...node,
      merchantCount: countMap.get(node.key) ?? 0,
    }));
    const nearest = nodes[0] ?? null;
    return {
      nearestDaysUntil: nearest?.daysUntil ?? null,
      nearestKey: nearest?.key ?? null,
      definitions: listPromoNodeDefinitions(),
      nodes,
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
    nodeKey = '',
  ) {
    this.assertType(listType);
    const key = listType === 'node' ? this.requireNodeKey_(nodeKey) : '';
    if (!Array.isArray(rows)) throw new BadRequestException('请上传商家行');
    if (rows.length > 20000) throw new BadRequestException('单次最多 20000 行');
    if (mode !== 'merge' && mode !== 'replace_platforms' && mode !== 'replace_all') {
      throw new BadRequestException('导入模式无效');
    }

    const cleaned = this.cleanRows(organizationId, listType, key, rows);
    if (cleaned.length === 0) throw new BadRequestException('没有有效商家行（需要平台 + MID）');

    const platforms = [...new Set(cleaned.map((row) => row.platformCode))];

    await this.prisma.$transaction(async (tx) => {
      if (mode === 'replace_all') {
        await tx.merchantOpsListItem.deleteMany({
          where: { organizationId, listType, nodeKey: key },
        });
        await tx.merchantOpsListItem.createMany({ data: cleaned });
        return;
      }

      if (mode === 'replace_platforms') {
        await tx.merchantOpsListItem.deleteMany({
          where: {
            organizationId,
            listType,
            nodeKey: key,
            platformCode: { in: platforms },
          },
        });
        await tx.merchantOpsListItem.createMany({ data: cleaned });
        return;
      }

      for (const row of cleaned) {
        await tx.merchantOpsListItem.upsert({
          where: {
            organizationId_listType_nodeKey_platformCode_mid: {
              organizationId: row.organizationId,
              listType: row.listType,
              nodeKey: row.nodeKey,
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
            epc: row.epc,
            commissionRate: row.commissionRate,
            avgOrderValue: row.avgOrderValue,
          },
        });
      }
    });

    const result = await this.list(organizationId, listType, key);
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
  async clear(
    organizationId: number,
    listType: MerchantOpsListType,
    platformCode?: string,
    nodeKey = '',
  ) {
    this.assertType(listType);
    const key = listType === 'node' ? this.requireNodeKey_(nodeKey) : '';
    const platform = platformCode?.trim().toLowerCase();
    await this.prisma.merchantOpsListItem.deleteMany({
      where: {
        organizationId,
        listType,
        nodeKey: key,
        ...(platform ? { platformCode: platform } : {}),
      },
    });
    return this.list(organizationId, listType, key);
  }

  private cleanRows(
    organizationId: number,
    listType: string,
    nodeKey: string,
    rows: MerchantOpsListRowInput[],
  ) {
    const cleaned: Array<{
      organizationId: number;
      listType: string;
      nodeKey: string;
      platformCode: string;
      mid: string;
      name: string;
      countryCode: string;
      merchantUrl: string;
      category: string;
      note: string;
      epc: string;
      commissionRate: string;
      avgOrderValue: string;
    }> = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const platformCode = this.normalizePlatform_(String(row.platformCode ?? ''));
      const mid = String(row.mid ?? '').trim().slice(0, 64);
      if (!platformCode || !mid) continue;
      const dedupe = `${platformCode}:${mid}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      cleaned.push({
        organizationId,
        listType,
        nodeKey,
        platformCode,
        mid,
        name: String(row.name ?? '').trim().slice(0, 255),
        countryCode: String(row.countryCode ?? '').trim().toUpperCase().slice(0, 32),
        merchantUrl: String(row.merchantUrl ?? '').trim().slice(0, 2048),
        category: String(row.category ?? '').trim().slice(0, 255),
        note: String(row.note ?? '').trim().slice(0, 500),
        epc: String(row.epc ?? '').trim().slice(0, 32),
        commissionRate: String(row.commissionRate ?? '').trim().slice(0, 32),
        avgOrderValue: String(row.avgOrderValue ?? '').trim().slice(0, 32),
      });
    }
    return cleaned;
  }

  private async ensureNodeSchema_() {
    const cols = await this.prisma.$queryRawUnsafe<Array<{ Field: string }>>(
      'SHOW COLUMNS FROM merchant_ops_list_items',
    );
    const names = new Set(cols.map((row) => row.Field));
    if (!names.has('node_key')) {
      await this.prisma.$executeRawUnsafe(
        "ALTER TABLE merchant_ops_list_items ADD COLUMN node_key VARCHAR(48) NOT NULL DEFAULT '' AFTER list_type",
      );
    }
    if (!names.has('epc')) {
      await this.prisma.$executeRawUnsafe(
        "ALTER TABLE merchant_ops_list_items ADD COLUMN epc VARCHAR(32) NOT NULL DEFAULT '' AFTER note",
      );
    }
    if (!names.has('commission_rate')) {
      await this.prisma.$executeRawUnsafe(
        "ALTER TABLE merchant_ops_list_items ADD COLUMN commission_rate VARCHAR(32) NOT NULL DEFAULT '' AFTER epc",
      );
    }
    if (!names.has('avg_order_value')) {
      await this.prisma.$executeRawUnsafe(
        "ALTER TABLE merchant_ops_list_items ADD COLUMN avg_order_value VARCHAR(32) NOT NULL DEFAULT '' AFTER commission_rate",
      );
    }

    const indexes = await this.prisma.$queryRawUnsafe<Array<{ Key_name: string; Column_name: string }>>(
      'SHOW INDEX FROM merchant_ops_list_items',
    );
    const byKey = new Map<string, string[]>();
    for (const row of indexes) {
      if (row.Key_name === 'PRIMARY') continue;
      const list = byKey.get(row.Key_name) ?? [];
      list.push(row.Column_name);
      byKey.set(row.Key_name, list);
    }
    const hasNewUnique = [...byKey.values()].some(
      (colsInKey) => colsInKey.join(',') === 'organization_id,list_type,node_key,platform_code,mid',
    );
    if (!hasNewUnique) {
      for (const [key, colsInKey] of byKey) {
        if (colsInKey.join(',') === 'organization_id,list_type,platform_code,mid') {
          await this.prisma.$executeRawUnsafe(
            `ALTER TABLE merchant_ops_list_items DROP INDEX \`${key}\``,
          );
        }
      }
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE merchant_ops_list_items ADD UNIQUE INDEX `merchant_ops_list_items_organization_id_list_type_node_key_platform_code_mid_key` (organization_id, list_type, node_key, platform_code, mid)',
      );
    }
    if (![...byKey.keys()].some((key) => key.includes('list_type_node_key'))) {
      await this.prisma.$executeRawUnsafe(
        'ALTER TABLE merchant_ops_list_items ADD INDEX `merchant_ops_list_items_organization_id_list_type_node_key_idx` (organization_id, list_type, node_key)',
      );
    }
  }

  private assertType(listType: string): asserts listType is MerchantOpsListType {
    if (listType !== 'violation' && listType !== 'recommend' && listType !== 'node') {
      throw new BadRequestException('名单类型只能是 violation、recommend 或 node');
    }
  }

  private requireNodeKey_(raw: string) {
    const key = String(raw ?? '').trim().toLowerCase();
    if (!key) throw new BadRequestException('节点推荐需要指定 nodeKey');
    if (!getPromoNodeDefinition(key)) {
      throw new BadRequestException(`未知促销节点：${key}`);
    }
    return key;
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
  private async remapLegacyPlatformCodes_(
    organizationId: number,
    listType: MerchantOpsListType,
    nodeKey: string,
  ) {
    const legacy = await this.prisma.merchantOpsListItem.findMany({
      where: {
        organizationId,
        listType,
        nodeKey,
        OR: [
          { platformCode: { startsWith: 'chuizhan' } },
          { platformCode: { in: ['cg', 'ui', 'fs', 'lh', 'rw', 'pm', 'lb', 'bsh'] } },
        ],
      },
      select: { id: true, platformCode: true, mid: true, nodeKey: true },
    });
    if (legacy.length === 0) return;

    for (const row of legacy) {
      const next = this.normalizePlatform_(row.platformCode);
      if (!next || next === row.platformCode) continue;
      const conflict = await this.prisma.merchantOpsListItem.findUnique({
        where: {
          organizationId_listType_nodeKey_platformCode_mid: {
            organizationId,
            listType,
            nodeKey: row.nodeKey,
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
    nodeKey: string;
    platformCode: string;
    mid: string;
    name: string;
    countryCode: string;
    merchantUrl: string;
    category: string;
    note: string;
    epc: string;
    commissionRate: string;
    avgOrderValue: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      listType: row.listType,
      nodeKey: row.nodeKey,
      platformCode: row.platformCode,
      mid: row.mid,
      name: row.name,
      countryCode: row.countryCode,
      merchantUrl: row.merchantUrl,
      category: row.category,
      note: row.note,
      epc: row.epc,
      commissionRate: row.commissionRate,
      avgOrderValue: row.avgOrderValue,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
