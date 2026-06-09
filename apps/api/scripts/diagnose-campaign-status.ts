/**
 * 诊断 campaignStatus 是否已写入，以及 enabledOnly 过滤后条数
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const totalRows = await prisma.adCampaignDaily.count();
  const withStatus = await prisma.adCampaignDaily.count({
    where: { NOT: { campaignStatus: '' } },
  });
  const statusGroups = await prisma.adCampaignDaily.groupBy({
    by: ['campaignStatus'],
    _count: { _all: true },
  });
  const uniqueCampaigns = await prisma.adCampaignDaily.groupBy({
    by: ['campaignId', 'campaignName'],
    _count: { _all: true },
  });

  console.log('ad_campaign_daily 总行数:', totalRows);
  console.log('含 campaignStatus 的行数:', withStatus);
  console.log('唯一 campaign 数:', uniqueCampaigns.length);
  console.log('campaignStatus 分布:', statusGroups);

  const enabledIds = new Set<string>();
  const allIds = new Set<string>();
  const rows = await prisma.adCampaignDaily.findMany({
    select: {
      campaignId: true,
      campaignName: true,
      campaignStatus: true,
      date: true,
    },
    orderBy: { date: 'desc' },
  });
  for (const r of rows) {
    allIds.add(r.campaignId);
    if ((r.campaignStatus ?? '').toUpperCase() === 'ENABLED') {
      enabledIds.add(r.campaignId);
    }
  }
  console.log('distinct campaignId (任意行):', allIds.size);
  console.log('distinct campaignId (至少一行 ENABLED):', enabledIds.size);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
