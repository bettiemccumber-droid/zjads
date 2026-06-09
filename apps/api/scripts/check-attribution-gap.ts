/**
 * 模拟 campaignSummary 归因：查询区间内无花费、但历史有系列的商家是否被补全
 */
import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';

const prisma = new PrismaClient();

async function main() {
  const startDate = '2026-05-28';
  const endDate = '2026-06-03';

  const user = await prisma.user.findFirst({ where: { isActive: true } });
  if (!user) return;

  const lh = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
    select: { id: true, ownerUserId: true, affiliateAlias: true },
  });
  if (!lh) return;

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: lh.id,
      orderDate: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
    },
    select: { merchantId: true, commission: true, externalOrderId: true },
  });

  const orderByMid = new Map<string, number>();
  const seen = new Set<string>();
  for (const o of orders) {
    if (seen.has(o.externalOrderId ?? '')) continue;
    seen.add(o.externalOrderId ?? '');
    const mid = o.merchantId ?? '';
    orderByMid.set(mid, (orderByMid.get(mid) ?? 0) + 1);
  }

  const inRangeAds = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: lh.ownerUserId,
      date: { gte: new Date(startDate), lte: new Date(endDate) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true },
  });

  const inRangeMids = new Set<string>();
  for (const ad of inRangeAds) {
    const p = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || p.affiliateAlias).toLowerCase();
    if (alias.startsWith('lh')) inRangeMids.add(ad.merchantId || p.merchantId);
  }

  const hist = await prisma.adCampaignDaily.findMany({
    where: { ownerUserId: lh.ownerUserId, campaignName: { contains: 'lh2' } },
    orderBy: { date: 'desc' },
    select: { campaignName: true, merchantId: true, affiliateAlias: true, date: true },
  });

  const histByMid = new Map<string, string>();
  for (const ad of hist) {
    const p = parseCampaignName(ad.campaignName);
    const mid = ad.merchantId || p.merchantId;
    if (!histByMid.has(mid)) histByMid.set(mid, ad.campaignName);
  }

  console.log(`区间 ${startDate} ~ ${endDate}`);
  console.log('LH 联盟去重订单:', seen.size);
  console.log('区间内有广告行的 lh2 商家:', inRangeMids.size);

  const gapMids = ['1998', '146792', '91322', '65835'];
  for (const mid of gapMids) {
    const ordersN = orderByMid.get(mid) ?? 0;
    const inRange = inRangeMids.has(mid);
    const histCamp = histByMid.get(mid);
    const inRangeRows = await prisma.adCampaignDaily.count({
      where: {
        ownerUserId: lh.ownerUserId,
        merchantId: mid,
        date: { gte: new Date(startDate), lte: new Date(endDate) },
      },
    });
    console.log(
      `\n${mid}: 订单 ${ordersN} | 区间 DB 行 ${inRangeRows} | 区间内有花费 ${inRange ? '是' : '否'} | 历史系列 ${histCamp ?? '无'}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
