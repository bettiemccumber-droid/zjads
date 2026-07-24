import { PrismaClient } from '@prisma/client';

import { ensurePlatformStatusMappings } from '../common/platform-status-defaults.util';

export interface PlatformCatalogEntry {
  code: string;
  name: string;
  sortOrder: number;
}

/** 与 prisma/seed 保持一致；新平台加入后 API 启动时会自动 upsert */
export const PLATFORM_CATALOG: PlatformCatalogEntry[] = [
  { code: 'partnermatic', name: 'PartnerMatic', sortOrder: 1 },
  { code: 'linkhaitao', name: 'LinkHaitao', sortOrder: 2 },
  { code: 'linkbux', name: 'LinkBux', sortOrder: 3 },
  { code: 'rewardoo', name: 'Rewardoo', sortOrder: 4 },
  { code: 'ultrainfluence', name: 'UltraInfluence', sortOrder: 5 },
  { code: 'partnerboost', name: 'PartnerBoost', sortOrder: 6 },
  { code: 'brandsparkhub', name: 'Brandsparkhub', sortOrder: 7 },
  { code: 'creatorflare', name: 'Creatorflare', sortOrder: 8 },
  { code: 'collabglow', name: 'CollabGlow', sortOrder: 9 },
];

/**
 * 平台凭证表单 schema
 */
export function buildPlatformCredentialSchema(platformCode: string) {
  return {
    fields: [
      { key: 'apiToken', label: 'API Token', required: true, secret: true },
      {
        key: 'externalChannelId',
        label: 'Channel ID',
        required: platformCode === 'partnermatic',
      },
    ],
  };
}

/**
 * 启动时补齐 platforms 表（部署仅 db push 时不跑 seed，新平台 Tab 靠此出现）
 */
export async function ensurePlatformCatalog(prisma: PrismaClient): Promise<void> {
  for (const p of PLATFORM_CATALOG) {
    const platform = await prisma.platform.upsert({
      where: { code: p.code },
      update: { name: p.name, sortOrder: p.sortOrder, isEnabled: true },
      create: {
        code: p.code,
        name: p.name,
        sortOrder: p.sortOrder,
        isEnabled: true,
        credentialSchema: buildPlatformCredentialSchema(p.code),
      },
    });

    await ensurePlatformStatusMappings(prisma, platform.id, p.code);
  }
}
