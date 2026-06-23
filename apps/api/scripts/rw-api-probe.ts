/**
 * Rewardoo API 多接口探测（本地诊断）
 * 用法: npx ts-node --transpile-only scripts/rw-api-probe.ts 2026-05-24 2026-06-23 [accountId]
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import {
  RW_COMMISSION_OPS,
  fetchRewardooOpPages,
  postRewardooCommissionSummary,
} from '../src/collectors/rewardoo-api.util';
import {
  normalizeRewardooOrders,
  summarizeRwCommissionApi,
} from '../src/collectors/rewardoo.collector';

dotenv.config();
const prisma = new PrismaClient();

function decrypt(p: string) {
  const key = Buffer.from(process.env.CREDENTIALS_ENCRYPTION_KEY ?? '', 'hex');
  const buf = Buffer.from(p, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString()) as {
    apiToken?: string;
  };
}

async function main() {
  const start = process.argv[2] ?? '2026-05-24';
  const end = process.argv[3] ?? '2026-06-23';
  const accountId = process.argv[4] ? parseInt(process.argv[4], 10) : undefined;

  const account = accountId
    ? await prisma.channelAccount.findUnique({
        where: { id: accountId },
        include: { platform: true },
      })
    : await prisma.channelAccount.findFirst({
        where: { platform: { code: 'rewardoo' }, isActive: true },
        include: { platform: true },
      });

  if (!account?.credentialsEnc) {
    console.log('未找到 Rewardoo 账号或缺少 CREDENTIALS_ENCRYPTION_KEY');
    process.exit(1);
  }

  const { apiToken } = decrypt(account.credentialsEnc);
  if (!apiToken) {
    console.log('无法解密 apiToken');
    process.exit(1);
  }

  console.log(`账号: ${account.displayName} (${account.affiliateAlias}) id=${account.id}`);
  console.log(`区间: ${start} ~ ${end}\n`);

  for (const op of RW_COMMISSION_OPS) {
    try {
      const rows = await fetchRewardooOpPages(op, apiToken, start, end);
      const summary = summarizeRwCommissionApi(rows as never[], op, { startDate: start, endDate: end });
      console.log(
        `[${op}] apiRows=${summary.apiListRows} orders=${summary.orderCount} comm=$${summary.totalCommission}`,
      );
      if (rows[0]) {
        console.log('  sample keys:', Object.keys(rows[0] as object).join(', '));
        console.log('  sample:', JSON.stringify(rows[0]).slice(0, 300));
      }
    } catch (e) {
      console.log(`[${op}] ERROR`, e instanceof Error ? e.message : e);
    }
  }

  try {
    const summaryRows = await postRewardooCommissionSummary(apiToken, start, end);
    console.log(`\n[summary/settlement] rows=${summaryRows.length}`);
    if (summaryRows[0]) console.log('  sample:', JSON.stringify(summaryRows[0]).slice(0, 300));
  } catch (e) {
    console.log('[summary/settlement] ERROR', e instanceof Error ? e.message : e);
  }

  const bundle = await import('../src/collectors/rewardoo-api.util').then((m) =>
    m.fetchRewardooCommissionData(apiToken, start, end),
  );
  const normalized = normalizeRewardooOrders(bundle.rows as never[], [], {
    startDate: start,
    endDate: end,
  });
  console.log(
    `\n[fallback] source=${bundle.source} normalized=${normalized.length} comm=$${normalized.reduce((s, o) => s + o.commission, 0).toFixed(2)}`,
  );
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
