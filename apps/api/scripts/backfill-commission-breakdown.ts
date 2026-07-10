/**
 * 为已有联盟订单补写 _commissionBreakdown（从 API 重算后 patch rawPayload + normalizedStatus）
 *
 * 用法: npx ts-node scripts/backfill-commission-breakdown.ts [startDate] [endDate] [platformCode?]
 * 示例: npx ts-node scripts/backfill-commission-breakdown.ts 2026-04-01 2026-06-30 linkbux
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { ensurePlatformStatusMappings } from '../src/common/platform-status-defaults.util';
import { fetchLinkBuxOrders, normalizeLinkBuxOrders } from '../src/collectors/linkbux.collector';
import {
  fetchLinkHaitaoCommissions,
  normalizeLinkHaitaoOrders,
} from '../src/collectors/linkhaitao.collector';
import {
  fetchPartnerMaticOrders,
  normalizePartnerMaticOrders,
} from '../src/collectors/partnermatic.collector';
import {
  fetchRewardooCommissions,
  normalizeRewardooOrders,
} from '../src/collectors/rewardoo.collector';
import { NormalizedOrder } from '../src/collectors/types';

dotenv.config();

const START = process.argv[2] ?? '2026-04-01';
const END = process.argv[3] ?? '2026-06-30';
const PLATFORM_FILTER = process.argv[4]?.trim().toLowerCase();

function decryptCredentials(payload: string): { apiToken?: string } {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

async function fetchNormalizedForAccount(
  platformCode: string,
  apiToken: string,
  mappings: { rawStatus: string; normalizedStatus: import('@prisma/client').NormalizedStatus }[],
): Promise<NormalizedOrder[]> {
  switch (platformCode) {
    case 'linkbux': {
      const rows = await fetchLinkBuxOrders(apiToken, START, END);
      return normalizeLinkBuxOrders(rows, mappings);
    }
    case 'linkhaitao': {
      const rows = await fetchLinkHaitaoCommissions(apiToken, START, END);
      return normalizeLinkHaitaoOrders(rows, mappings);
    }
    case 'partnermatic': {
      const rows = await fetchPartnerMaticOrders(apiToken, START, END);
      return normalizePartnerMaticOrders(rows, mappings);
    }
    case 'rewardoo': {
      const bundle = await fetchRewardooCommissions(apiToken, START, END);
      return normalizeRewardooOrders(bundle.rows, mappings, { startDate: START, endDate: END });
    }
    default:
      return [];
  }
}

async function ensurePlatformMappings(prisma: PrismaClient, platformId: number, platformCode: string) {
  await ensurePlatformStatusMappings(prisma, platformId, platformCode);
  return prisma.platformStatusMapping.findMany({ where: { platformId } });
}

async function main() {
  const prisma = new PrismaClient();
  const accounts = await prisma.channelAccount.findMany({
    where: {
      ...(PLATFORM_FILTER ? { platform: { code: PLATFORM_FILTER } } : {}),
    },
    include: { platform: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const account of accounts) {
    const code = account.platform.code;
    if (!['linkbux', 'linkhaitao', 'partnermatic', 'rewardoo'].includes(code)) {
      skipped += 1;
      continue;
    }

    const { apiToken } = decryptCredentials(account.credentialsEnc);
    if (!apiToken) {
      console.log(`跳过 ${account.displayName}：无 token`);
      skipped += 1;
      continue;
    }

    console.log(`\n拉取 ${account.displayName} (${code}) ${START}~${END}…`);
    const mappings = await ensurePlatformMappings(prisma, account.platformId, code);
    let normalized: NormalizedOrder[];
    try {
      normalized = await fetchNormalizedForAccount(code, apiToken, mappings);
    } catch (e) {
      console.error(`  API 失败: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    const byExt = new Map(normalized.map((o) => [o.externalOrderId, o]));
    console.log(`  API 合并订单: ${byExt.size}`);

    const existing = await prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: account.id,
        orderDate: {
          gte: new Date(`${START}T00:00:00.000Z`),
          lte: new Date(`${END}T23:59:59.999Z`),
        },
      },
    });

    let accountUpdated = 0;
    for (const row of existing) {
      const fresh = byExt.get(row.externalOrderId);
      if (!fresh?.rawPayload) continue;
      await prisma.affiliateOrder.update({
        where: { id: row.id },
        data: {
          rawPayload: fresh.rawPayload as object,
          normalizedStatus: fresh.normalizedStatus,
          rawStatus: fresh.rawStatus,
        },
      });
      accountUpdated += 1;
    }

    console.log(`  已更新 ${accountUpdated}/${existing.length} 笔`);
    updated += accountUpdated;
  }

  console.log(`\n合计更新 ${updated} 笔，跳过 ${skipped} 个账号`);
  await prisma.$disconnect();
}

main().catch(console.error);
