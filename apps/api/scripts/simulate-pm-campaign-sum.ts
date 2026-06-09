import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';
import { dedupeAffiliateOrderKey } from '../src/common/order-dedupe.util';

const prisma = new PrismaClient();

async function main() {
  const startDate = '2026-05-28';
  const endDate = '2026-06-03';

  const pm = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'partnermatic' } },
    select: { id: true, ownerUserId: true, affiliateAlias: true },
  });
  if (!pm) return;

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: pm.id,
      orderDate: {
        gte: new Date(`${startDate}T00:00:00.000Z`),
        lte: new Date(`${endDate}T23:59:59.999Z`),
      },
    },
    select: { merchantId: true, commission: true, externalOrderId: true },
  });

  const byKey = new Map<string, { orders: number; comm: number }>();
  const byMid = new Map<string, { orders: number; comm: number }>();
  const seen = new Set<string>();

  for (const o of orders) {
    const oid = o.externalOrderId ?? '';
    if (seen.has(oid)) continue;
    seen.add(oid);
    const mid = o.merchantId ?? '';
    const key = `${mid}|pm1`;
    const comm = Number(o.commission);
    const bk = byKey.get(key) ?? { orders: 0, comm: 0 };
    bk.orders += 1;
    bk.comm += comm;
    byKey.set(key, bk);
    const bm = byMid.get(mid) ?? { orders: 0, comm: 0 };
    bm.orders += 1;
    bm.comm += comm;
    byMid.set(mid, bm);
  }

  console.log('PM API 去重:', seen.size, '单');

  const inRange = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: pm.ownerUserId,
      date: { gte: new Date(startDate), lte: new Date(endDate) },
    },
  });

  const map = new Map<string, { merchantId: string; alias: string; cost: number; clicks: number; name: string }>();
  for (const ad of inRange) {
    const key = `${ad.customerId}|${ad.campaignId}`;
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (!alias.startsWith('pm')) continue;
    if (!map.has(key)) {
      map.set(key, {
        merchantId: ad.merchantId || parsed.merchantId,
        alias,
        cost: 0,
        clicks: 0,
        name: ad.campaignName,
      });
    }
    const row = map.get(key)!;
    row.cost += Number(ad.cost);
    row.clicks += ad.clicks;
  }

  const hist = await prisma.adCampaignDaily.findMany({
    where: { ownerUserId: pm.ownerUserId },
    orderBy: { date: 'desc' },
  });
  const seenCamp = new Set<string>();
  for (const ad of hist) {
    const key = `${ad.customerId}|${ad.campaignId}`;
    if (seenCamp.has(key) || map.has(key)) {
      seenCamp.add(key);
      continue;
    }
    seenCamp.add(key);
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    const merchantId = ad.merchantId || parsed.merchantId;
    const exact = byKey.get(`${merchantId}|${alias}`);
    const affiliate = exact ?? (alias.startsWith('pm') ? byMid.get(merchantId) : undefined);
    if (!affiliate || (affiliate.orders === 0 && affiliate.comm === 0)) continue;
    map.set(key, { merchantId, alias, cost: 0, clicks: 0, name: ad.campaignName });
  }

  let sumOrders = 0;
  let sumComm = 0;
  console.log('\n系列归因明细（当前逻辑，会重复）:');
  for (const row of map.values()) {
    const exact = byKey.get(`${row.merchantId}|${row.alias}`);
    const aff = exact ?? byMid.get(row.merchantId) ?? { orders: 0, comm: 0 };
    if (aff.orders > 0) {
      console.log(`  ${row.name.slice(0, 40)} | ${aff.orders}单 $${aff.comm.toFixed(2)} cost=$${row.cost.toFixed(2)}`);
    }
    sumOrders += aff.orders;
    sumComm += aff.comm;
  }
  console.log('\n表合计（重复）:', sumOrders, '单', '$' + sumComm.toFixed(2));

  // 去重模拟
  const winnerByKey = new Map<string, number>();
  const rows = [...map.values()].map((row, idx) => ({ ...row, idx }));
  const withAff = rows.map((row) => {
    const aff = byKey.get(`${row.merchantId}|${row.alias}`) ?? byMid.get(row.merchantId) ?? { orders: 0, comm: 0 };
    return { ...row, orderCount: aff.orders, commission: aff.comm };
  });
  withAff.forEach((row, idx) => {
    if (row.orderCount <= 0) return;
    const key = row.alias.startsWith('pm') ? `pm:${row.merchantId}` : `${row.merchantId}|${row.alias}`;
    const prev = winnerByKey.get(key);
    if (prev === undefined || withAff[prev].cost < row.cost) winnerByKey.set(key, idx);
  });
  let deduped = 0;
  let dedupedComm = 0;
  withAff.forEach((row, idx) => {
    const key = row.alias.startsWith('pm') ? `pm:${row.merchantId}` : `${row.merchantId}|${row.alias}`;
    if (winnerByKey.get(key) === idx) {
      deduped += row.orderCount;
      dedupedComm += row.commission;
    }
  });
  console.log('表合计（去重后）:', deduped, '单', '$' + dedupedComm.toFixed(2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
