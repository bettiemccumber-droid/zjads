import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';

const prisma = new PrismaClient();

async function main() {
  const start = '2026-05-28';
  const end = '2026-06-03';

  const pm = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'partnermatic' } },
    select: { id: true, ownerUserId: true },
  });
  if (!pm) return;

  const ads = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: pm.ownerUserId,
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true, cost: true, campaignId: true },
  });

  const byMid = new Map<string, Array<{ name: string; cost: number; id: string }>>();
  for (const ad of ads) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (!alias.startsWith('pm')) continue;
    const mid = ad.merchantId || parsed.merchantId;
    if (!byMid.has(mid)) byMid.set(mid, []);
    const list = byMid.get(mid)!;
    const existing = list.find((c) => c.id === ad.campaignId);
    if (existing) {
      existing.cost += Number(ad.cost);
    } else {
      list.push({ name: ad.campaignName, cost: Number(ad.cost), id: ad.campaignId });
    }
  }

  console.log('PM 商家多系列（会导致订单重复归因）:');
  let dupCount = 0;
  for (const [mid, camps] of byMid) {
    if (camps.length > 1) {
      dupCount++;
      console.log(`\n  merchant ${mid}: ${camps.length} 个系列`);
      for (const c of camps) console.log(`    ${c.name} cost=$${c.cost.toFixed(2)}`);
    }
  }
  if (!dupCount) console.log('  (区间内无)');

  const allPm = await prisma.adCampaignDaily.findMany({
    where: { ownerUserId: pm.ownerUserId },
    select: { campaignName: true, merchantId: true, affiliateAlias: true, campaignId: true },
  });
  const allByMid = new Map<string, Set<string>>();
  for (const ad of allPm) {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias).toLowerCase();
    if (!alias.startsWith('pm')) continue;
    const mid = ad.merchantId || parsed.merchantId;
    if (!allByMid.has(mid)) allByMid.set(mid, new Set());
    allByMid.get(mid)!.add(ad.campaignId);
  }
  console.log('\nPM 全库同商家多 campaign_id（含 supplement 重复归因来源）:');
  for (const [mid, ids] of allByMid) {
    if (ids.size > 1) {
      console.log(`  merchant ${mid}: ${ids.size} 个系列 ID`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
