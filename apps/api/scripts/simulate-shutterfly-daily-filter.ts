import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';
import { resolveCampaignGroupKey } from '../src/common/campaign-group.util';
import { filterCampaignDailyByGroupStatus } from '../src/common/campaign-status.util';

const prisma = new PrismaClient();

async function main() {
  const ownerId = 2;
  const startDate = '2026-05-26';
  const endDate = '2026-06-07';

  const adRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: ownerId,
      campaignName: { contains: 'Shutterfly' },
      date: { gte: new Date(startDate), lte: new Date(endDate) },
    },
    orderBy: [{ date: 'desc' }],
  });

  type Row = {
    date: string;
    campaignGroupKey: string;
    campaignStatus: string;
    cost: number;
    clicks: number;
  };

  const raw: Row[] = adRows.map((ad) => {
    const parsed = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || parsed.affiliateAlias || '').toLowerCase();
    const merchantId = ad.merchantId || parsed.merchantId;
    return {
      date: ad.date.toISOString().slice(0, 10),
      campaignGroupKey: resolveCampaignGroupKey({
        campaignName: ad.campaignName,
        merchantId,
        affiliateAlias: alias,
        customerId: ad.customerId,
        campaignId: ad.campaignId,
      }),
      campaignStatus: ad.campaignStatus ?? '',
      cost: Number(ad.cost),
      clicks: ad.clicks,
    };
  });

  const oldFilter = raw.filter((r) => r.campaignStatus.toUpperCase() === 'ENABLED');
  const newFilter = filterCampaignDailyByGroupStatus(raw, 'active');

  console.log('raw rows', raw.length);
  console.log('old active filter', oldFilter.length, 'clicks', oldFilter.reduce((s, r) => s + r.clicks, 0));
  console.log('new group filter', newFilter.length, 'clicks', newFilter.reduce((s, r) => s + r.clicks, 0));
  console.log('dates old', [...new Set(oldFilter.map((r) => r.date))].sort());
  console.log('dates new', [...new Set(newFilter.map((r) => r.date))].sort());
}

main().finally(() => prisma.$disconnect());
