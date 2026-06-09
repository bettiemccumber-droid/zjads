import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';

const prisma = new PrismaClient();

async function main() {
  const start = '2026-05-27';
  const end = '2026-06-02';
  const dateFilter = {
    gte: new Date(`${start}T00:00:00.000Z`),
    lte: new Date(`${end}T23:59:59.999Z`),
  };

  const pm = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'partnermatic' } },
    select: { id: true, ownerUserId: true },
  });
  if (!pm) return;

  const orders = await prisma.affiliateOrder.findMany({
    where: { channelAccountId: pm.id, orderDate: dateFilter },
    select: {
      merchantId: true,
      merchantName: true,
      commission: true,
      externalOrderId: true,
    },
  });

  const adRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: pm.ownerUserId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true },
  });

  const pmMids = new Set<string>();
  for (const ad of adRows) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (alias.startsWith('pm')) {
      pmMids.add(ad.merchantId || parsed.merchantId);
    }
  }

  const orphanMap = new Map<string, { name: string; orders: number; comm: number }>();
  const seen = new Set<string>();
  let matched = 0;
  let matchedComm = 0;
  let totalComm = 0;

  for (const o of orders) {
    totalComm += Number(o.commission);
    const orderKey = o.externalOrderId ?? '';
    if (seen.has(orderKey)) continue;
    seen.add(orderKey);

    const mid = o.merchantId ?? '';
    if (pmMids.has(mid)) {
      matched += 1;
      matchedComm += Number(o.commission);
    } else {
      const cur = orphanMap.get(mid) ?? { name: o.merchantName ?? '', orders: 0, comm: 0 };
      cur.orders += 1;
      cur.comm += Number(o.commission);
      orphanMap.set(mid, cur);
    }
  }

  console.log(`PM 联盟去重: ${seen.size} 单 / $${totalComm.toFixed(2)}`);
  console.log(`Sheet pm 系列商家: ${pmMids.size} 个`);
  console.log(`可归因: ${matched} 单 / $${matchedComm.toFixed(2)}`);
  console.log(`孤儿: ${seen.size - matched} 单 / $${(totalComm - matchedComm).toFixed(2)}`);
  console.log('\n=== 有订单但 Sheet 无 pm 广告系列的商家 ===');
  for (const [mid, v] of [...orphanMap.entries()].sort((a, b) => b[1].comm - a[1].comm)) {
    console.log(`  ${mid} ${v.name} | ${v.orders}单 $${v.comm.toFixed(2)}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
