import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';

const prisma = new PrismaClient();

async function main() {
  const source = await prisma.adDataSource.findFirst({ where: { id: 1 } });
  if (!source) throw new Error('ad source 1 missing');

  const csvUrl = buildSheetCsvUrl(source.sheetId, source.mainTab);
  const res = await axios.get<string>(csvUrl, {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });

  const rows = parseAdSheetCsv(res.data).filter(
    (r) => r.campaignName.includes('148-lb2-Shutterfly') && r.date >= '2026-06-05' && r.date <= '2026-06-07',
  );

  console.log('parsed after dedupe:');
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(r.date, 'imp', r.impressions, 'clk', r.clicks, 'cost', r.cost);
  }

  let upserted = 0;
  const allRows = parseAdSheetCsv(res.data);
  for (const row of allRows) {
    await prisma.adCampaignDaily.upsert({
      where: {
        ownerUserId_date_customerId_campaignId: {
          ownerUserId: source.ownerUserId,
          date: new Date(row.date),
          customerId: row.customerId,
          campaignId: row.campaignId,
        },
      },
      create: {
        ownerUserId: source.ownerUserId,
        date: new Date(row.date),
        customerId: row.customerId,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        campaignStatus: row.campaignStatus,
        affiliateAlias: row.affiliateAlias,
        merchantId: row.merchantId,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        campaignBudget: row.campaignBudget,
        searchBudgetLostIs: row.searchBudgetLostIs,
        searchRankLostIs: row.searchRankLostIs,
        avgCpc: row.avgCpc,
        maxCpc: row.maxCpc,
        currency: row.currency,
      },
      update: {
        campaignName: row.campaignName,
        campaignStatus: row.campaignStatus,
        affiliateAlias: row.affiliateAlias,
        merchantId: row.merchantId,
        impressions: row.impressions,
        clicks: row.clicks,
        cost: row.cost,
        campaignBudget: row.campaignBudget,
        searchBudgetLostIs: row.searchBudgetLostIs,
        searchRankLostIs: row.searchRankLostIs,
        avgCpc: row.avgCpc,
        maxCpc: row.maxCpc,
        currency: row.currency,
      },
    });
    upserted += 1;
  }

  console.log('reimported rows', upserted);
}

main().finally(() => prisma.$disconnect());
