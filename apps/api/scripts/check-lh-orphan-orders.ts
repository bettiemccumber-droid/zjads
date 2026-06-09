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

  const lh = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { id: true, ownerUserId: true },
  });
  if (!lh) return;

  const orders = await prisma.affiliateOrder.findMany({
    where: { channelAccountId: lh.id, orderDate: dateFilter },
    select: { merchantId: true, commission: true, merchantName: true },
  });
  const totalComm = orders.reduce((s, o) => s + Number(o.commission), 0);

  const clicks = await prisma.affiliateMerchantClickDaily.groupBy({
    by: ['merchantId'],
    _sum: { clicks: true },
    where: {
      channelAccountId: lh.id,
      clickDate: { gte: new Date(start), lte: new Date(end) },
    },
  });
  const clickByMid = new Map(clicks.map((c) => [c.merchantId, c._sum.clicks ?? 0]));

  const adRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true },
  });

  const allLhMids = new Set<string>();
  for (const ad of adRows) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (!alias.startsWith('lh')) continue;
    allLhMids.add(ad.merchantId || parsed.merchantId);
  }

  let matched = 0;
  let matchedComm = 0;
  const orphan: Array<{
    mid: string;
    name: string;
    orders: number;
    comm: number;
    clicks: number;
  }> = [];

  const orphanMap = new Map<string, { name: string; orders: number; comm: number }>();
  for (const o of orders) {
    const mid = o.merchantId ?? '';
    if (allLhMids.has(mid)) {
      matched += 1;
      matchedComm += Number(o.commission);
    } else {
      const cur = orphanMap.get(mid) ?? { name: o.merchantName ?? '', orders: 0, comm: 0 };
      cur.orders += 1;
      cur.comm += Number(o.commission);
      orphanMap.set(mid, cur);
    }
  }

  for (const [mid, v] of orphanMap) {
    orphan.push({ mid, name: v.name, orders: v.orders, comm: v.comm, clicks: clickByMid.get(mid) ?? 0 });
  }
  orphan.sort((a, b) => b.comm - a.comm);

  console.log(`LH 联盟全量: ${orders.length} 单 / $${totalComm.toFixed(2)}`);
  console.log(`Sheet 中 lh2 广告系列涉及商家: ${allLhMids.size} 个`);
  console.log(`可进广告系列表: ${matched} 单 / $${matchedComm.toFixed(2)}`);
  console.log(`无广告系列（进不了广告系列表）: ${orders.length - matched} 单 / $${(totalComm - matchedComm).toFixed(2)}`);
  console.log('\n=== 有订单但 Sheet 里没有 lh2 广告系列的商家 ===');
  for (const r of orphan) {
    console.log(
      `  ${r.mid} ${r.name} | ${r.orders}单 $${r.comm.toFixed(2)} | 联盟点击 ${r.clicks}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
