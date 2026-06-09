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

  const lhAccount = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { id: true, affiliateAlias: true, ownerUserId: true },
  });
  if (!lhAccount) return;

  const orders = await prisma.affiliateOrder.findMany({
    where: { channelAccountId: lhAccount.id, orderDate: dateFilter },
    select: { merchantId: true, commission: true, externalOrderId: true },
  });
  const totalComm = orders.reduce((s, o) => s + Number(o.commission), 0);
  console.log(`LH 订单: ${orders.length} 单, 佣金 $${totalComm.toFixed(2)}`);

  const adRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lhAccount.ownerUserId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: { campaignName: true, campaignStatus: true, merchantId: true, affiliateAlias: true },
  });

  const lhCampaigns = new Map<string, { name: string; mid: string; alias: string; enabled: boolean }>();
  for (const ad of adRows) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (!alias.startsWith('lh')) continue;
    const mid = ad.merchantId || parsed.merchantId;
    const key = `${ad.campaignName}`;
    const enabled = (ad.campaignStatus ?? '').toUpperCase() === 'ENABLED';
    if (!lhCampaigns.has(key)) {
      lhCampaigns.set(key, { name: ad.campaignName, mid, alias, enabled });
    }
  }

  const enabledLh = [...lhCampaigns.values()].filter((c) => c.enabled);
  const enabledMids = new Set(enabledLh.map((c) => c.mid));

  let matchedOrders = 0;
  let matchedComm = 0;
  const unmatchedMids = new Map<string, { count: number; comm: number }>();

  for (const o of orders) {
    const mid = o.merchantId ?? '';
    if (enabledMids.has(mid)) {
      matchedOrders += 1;
      matchedComm += Number(o.commission);
    } else {
      const u = unmatchedMids.get(mid) ?? { count: 0, comm: 0 };
      u.count += 1;
      u.comm += Number(o.commission);
      unmatchedMids.set(mid, u);
    }
  }

  console.log(`\nLH 广告系列(全部): ${lhCampaigns.size}, 已启用: ${enabledLh.length}`);
  console.log(`已启用系列能匹配的订单: ${matchedOrders} 单 / $${matchedComm.toFixed(2)}`);
  console.log(`未匹配到已启用 lh2 系列的订单: ${orders.length - matchedOrders} 单 / $${(totalComm - matchedComm).toFixed(2)}`);

  console.log('\n=== 未匹配商家（有订单但无已启用 lh 广告系列）===');
  for (const [mid, v] of [...unmatchedMids.entries()].sort((a, b) => b[1].comm - a[1].comm)) {
    console.log(`  mid=${mid} orders=${v.count} comm=$${v.comm.toFixed(2)}`);
  }

  const clicks = await prisma.affiliateMerchantClickDaily.groupBy({
    by: ['merchantId'],
    _sum: { clicks: true },
    where: {
      channelAccountId: lhAccount.id,
      clickDate: { gte: new Date(start), lte: new Date(end) },
    },
  });
  let matchedClicks = 0;
  for (const c of clicks) {
    if (enabledMids.has(c.merchantId)) matchedClicks += c._sum.clicks ?? 0;
  }
  console.log(`\nLH 总点击: ${clicks.reduce((s, c) => s + (c._sum.clicks ?? 0), 0)}`);
  console.log(`已启用 lh 系列能匹配的点击: ${matchedClicks}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
