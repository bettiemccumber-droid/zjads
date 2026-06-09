/**
 * 为已有 LH 订单补写 _commissionBreakdown（无需删库，从 API 重算后 patch rawPayload）
 */
import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import {
  fetchLinkHaitaoCommissions,
  normalizeLinkHaitaoOrders,
} from '../src/collectors/linkhaitao.collector';

dotenv.config();

const START = process.argv[2] ?? '2026-05-01';
const END = process.argv[3] ?? '2026-05-31';

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

async function main() {
  const prisma = new PrismaClient();
  const lhAccounts = await prisma.channelAccount.findMany({
    where: { platform: { code: 'linkhaitao' } },
    include: { platform: true },
  });

  const mappings = await prisma.platformStatusMapping.findMany({
    where: { platformId: lhAccounts[0]?.platformId },
  });

  let updated = 0;
  for (const account of lhAccounts) {
    const { apiToken } = decryptCredentials(account.credentialsEnc);
    if (!apiToken) continue;

    console.log(`拉取 ${account.displayName} ${START}~${END}…`);
    const rows = await fetchLinkHaitaoCommissions(apiToken, START, END);
    const normalized = normalizeLinkHaitaoOrders(rows, mappings);
    const byExt = new Map(normalized.map((o) => [o.externalOrderId, o]));

    const existing = await prisma.affiliateOrder.findMany({
      where: {
        channelAccountId: account.id,
        orderDate: {
          gte: new Date(`${START}T00:00:00.000Z`),
          lte: new Date(`${END}T23:59:59.999Z`),
        },
      },
    });

    for (const row of existing) {
      const fresh = byExt.get(row.externalOrderId);
      if (!fresh?.rawPayload) continue;
      await prisma.affiliateOrder.update({
        where: { id: row.id },
        data: { rawPayload: fresh.rawPayload as object },
      });
      updated += 1;
    }
  }

  console.log(`已更新 ${updated} 笔 LH 订单的佣金拆分`);
  await prisma.$disconnect();
}

main().catch(console.error);
