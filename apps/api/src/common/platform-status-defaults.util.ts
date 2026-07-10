import { NormalizedStatus, PlatformStatusMapping, PrismaClient } from '@prisma/client';
import { normalizeStatus } from '../collectors/status-normalizer';

type StatusMapping = { raw: string; norm: NormalizedStatus };

const PM_DEFAULTS: StatusMapping[] = [
  { raw: 'Approved', norm: NormalizedStatus.approved },
  { raw: 'APPROVED', norm: NormalizedStatus.approved },
  { raw: 'Pending', norm: NormalizedStatus.pending },
  { raw: 'PENDING', norm: NormalizedStatus.pending },
  { raw: 'Rejected', norm: NormalizedStatus.rejected },
  { raw: 'REJECTED', norm: NormalizedStatus.rejected },
  { raw: 'Canceled', norm: NormalizedStatus.rejected },
  { raw: 'CANCELED', norm: NormalizedStatus.rejected },
];

const LH_DEFAULTS: StatusMapping[] = [
  { raw: 'approved', norm: NormalizedStatus.approved },
  { raw: 'pending', norm: NormalizedStatus.pending },
  { raw: 'EXPIRED', norm: NormalizedStatus.rejected },
  { raw: 'REJECTED', norm: NormalizedStatus.rejected },
  { raw: 'Rejected', norm: NormalizedStatus.rejected },
];

const LB_DEFAULTS: StatusMapping[] = [
  { raw: 'Approved', norm: NormalizedStatus.approved },
  { raw: 'APPROVED', norm: NormalizedStatus.approved },
  { raw: 'Pending', norm: NormalizedStatus.pending },
  { raw: 'PENDING', norm: NormalizedStatus.pending },
  { raw: 'Rejected', norm: NormalizedStatus.rejected },
  { raw: 'REJECTED', norm: NormalizedStatus.rejected },
];

const RW_DEFAULTS: StatusMapping[] = [
  { raw: 'approved', norm: NormalizedStatus.approved },
  { raw: 'Approved', norm: NormalizedStatus.approved },
  { raw: 'APPROVED', norm: NormalizedStatus.approved },
  { raw: 'effective', norm: NormalizedStatus.approved },
  { raw: 'Effective', norm: NormalizedStatus.approved },
  { raw: 'pending', norm: NormalizedStatus.pending },
  { raw: 'Pending', norm: NormalizedStatus.pending },
  { raw: 'PENDING', norm: NormalizedStatus.pending },
  { raw: 'new', norm: NormalizedStatus.pending },
  { raw: 'New', norm: NormalizedStatus.pending },
  { raw: 'pre_effective', norm: NormalizedStatus.pending },
  { raw: 'pre_expired', norm: NormalizedStatus.pending },
  { raw: 'rejected', norm: NormalizedStatus.rejected },
  { raw: 'Rejected', norm: NormalizedStatus.rejected },
  { raw: 'REJECTED', norm: NormalizedStatus.rejected },
  { raw: 'expired', norm: NormalizedStatus.rejected },
  { raw: 'Expired', norm: NormalizedStatus.rejected },
];

/**
 * 各平台默认订单状态映射（与 prisma/seed 一致）
 */
export function defaultStatusMappingsForPlatform(platformCode: string): StatusMapping[] {
  switch (platformCode) {
    case 'partnermatic':
      return PM_DEFAULTS;
    case 'linkhaitao':
      return LH_DEFAULTS;
    case 'linkbux':
      return LB_DEFAULTS;
    case 'rewardoo':
      return RW_DEFAULTS;
    default:
      return PM_DEFAULTS.slice(0, 4);
  }
}

/**
 * 补齐平台状态映射（避免库内仅有 Approved/Pending 导致 Rejected 落入 unknown）
 */
export async function ensurePlatformStatusMappings(
  prisma: PrismaClient,
  platformId: number,
  platformCode: string,
): Promise<void> {
  const defaults = defaultStatusMappingsForPlatform(platformCode);
  for (const m of defaults) {
    await prisma.platformStatusMapping.upsert({
      where: {
        platformId_rawStatus: { platformId, rawStatus: m.raw },
      },
      update: { normalizedStatus: m.norm },
      create: {
        platformId,
        rawStatus: m.raw,
        normalizedStatus: m.norm,
      },
    });
  }
}

/**
 * 按最新映射纠正已入库订单的 normalizedStatus（修复历史 Rejected→unknown）
 */
export async function renormalizeOrdersForAccounts(
  prisma: PrismaClient,
  accountIds: number[],
): Promise<number> {
  if (!accountIds.length) return 0;

  const orders = await prisma.affiliateOrder.findMany({
    where: { channelAccountId: { in: accountIds } },
    select: {
      id: true,
      rawStatus: true,
      normalizedStatus: true,
      channelAccount: {
        select: { platformId: true, platform: { select: { code: true } } },
      },
    },
  });

  const mappingCache = new Map<number, PlatformStatusMapping[]>();
  let updated = 0;

  for (const o of orders) {
    const platformId = o.channelAccount.platformId;
    const platformCode = o.channelAccount.platform.code;
    if (!mappingCache.has(platformId)) {
      await ensurePlatformStatusMappings(prisma, platformId, platformCode);
      const rows = await prisma.platformStatusMapping.findMany({
        where: { platformId },
      });
      mappingCache.set(platformId, rows);
    }
    const { normalizedStatus } = normalizeStatus(
      o.rawStatus,
      mappingCache.get(platformId)!,
    );
    if (normalizedStatus !== o.normalizedStatus) {
      await prisma.affiliateOrder.update({
        where: { id: o.id },
        data: { normalizedStatus },
      });
      updated += 1;
    }
  }

  return updated;
}
