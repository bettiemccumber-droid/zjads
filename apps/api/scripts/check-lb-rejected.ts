/**
 * 诊断 LinkBux 失效/拒绝订单是否入库及状态映射
 */
import { PrismaClient, NormalizedStatus } from '@prisma/client';
import {
  ensurePlatformStatusMappings,
  renormalizeOrdersForAccounts,
} from '../src/common/platform-status-defaults.util';
import * as dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();
const START = '2026-05-01';
const END = '2026-05-31';

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkbux' } },
    include: { platform: true },
  });
  if (!lb) {
    console.log('无 linkbux 账号');
    return;
  }
  console.log(`账号: ${lb.displayName} (${lb.affiliateAlias}) id=${lb.id}\n`);

  await ensurePlatformStatusMappings(prisma, lb.platformId, lb.platform.code);
  const fixed = await renormalizeOrdersForAccounts(prisma, [lb.id]);
  console.log(`已纠正 normalizedStatus 行数: ${fixed}\n`);

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: lb.id,
      orderDate: {
        gte: new Date(`${START}T00:00:00.000Z`),
        lte: new Date(`${END}T23:59:59.999Z`),
      },
    },
    select: {
      externalOrderId: true,
      merchantId: true,
      merchantName: true,
      commission: true,
      rawStatus: true,
      normalizedStatus: true,
      orderDate: true,
    },
  });

  const byNorm: Record<string, { count: number; comm: number }> = {};
  const byRaw: Record<string, number> = {};
  for (const o of orders) {
    const st = o.normalizedStatus;
    if (!byNorm[st]) byNorm[st] = { count: 0, comm: 0 };
    byNorm[st].count += 1;
    byNorm[st].comm += Number(o.commission);
    const raw = o.rawStatus || '(empty)';
    byRaw[raw] = (byRaw + 1) || 0;
    byRaw[raw] = (byRaw[raw] ?? 0) + 1;
  }

  console.log(`区间 ${START}~${END} 订单行: ${orders.length}`);
  console.log('\n按 normalizedStatus:');
  for (const [k, v] of Object.entries(byNorm)) {
    console.log(`  ${k}: ${v.count} 单, 佣金 $${v.comm.toFixed(2)}`);
  }
  console.log('\n按 rawStatus TOP:');
  const rawSorted = Object.entries(byRaw).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rawSorted.slice(0, 15)) {
    console.log(`  ${k}: ${n}`);
  }

  const rejected = orders.filter((o) => o.normalizedStatus === NormalizedStatus.rejected);
  console.log(`\nrejected 样本 (${rejected.length}):`);
  for (const o of rejected.slice(0, 10)) {
    console.log(
      `  ${o.externalOrderId} mid=${o.merchantId} raw=${o.rawStatus} $${o.commission} date=${o.orderDate.toISOString().slice(0, 10)}`,
    );
  }

  const unknownRejectedLike = orders.filter((o) => {
    const r = (o.rawStatus || '').toLowerCase();
    return (
      o.normalizedStatus === NormalizedStatus.unknown &&
      (r.includes('reject') || r.includes('declin') || r.includes('cancel') || r.includes('invalid'))
    );
  });
  if (unknownRejectedLike.length) {
    console.log(`\n可能应为 rejected 但落在 unknown (${unknownRejectedLike.length}):`);
    for (const o of unknownRejectedLike.slice(0, 10)) {
      console.log(`  raw=${o.rawStatus} $${o.commission} ${o.externalOrderId}`);
    }
  }

  const mappings = await prisma.platformStatusMapping.findMany({
    where: { platformId: lb.platformId },
  });
  console.log(`\nLB 状态映射条数: ${mappings.length}`);
  for (const m of mappings) {
    console.log(`  ${m.rawStatus} -> ${m.normalizedStatus}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
