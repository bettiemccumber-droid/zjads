/**
 * 从已配置的 Google Sheet 重新导入，回填 campaign_status
 */
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import {
  buildSheetCsvUrl,
  parseAdSheetCsv,
} from '../src/ad-sources/sheet-parser.util';

const prisma = new PrismaClient();

async function main() {
  const sources = await prisma.adDataSource.findMany({ where: { isActive: true } });
  if (!sources.length) {
    console.log('无广告数据源');
    return;
  }

  for (const source of sources) {
    const csvUrl = buildSheetCsvUrl(source.sheetId, source.mainTab);
    console.log('导入:', source.name, csvUrl);
    const res = await axios.get<string>(csvUrl, {
      timeout: 120000,
      responseType: 'text',
      headers: { 'User-Agent': 'ZJADS/1.0' },
    });
    const rows = parseAdSheetCsv(res.data);
    console.log('解析行数:', rows.length);
    const withStatus = rows.filter((r) => r.campaignStatus).length;
    console.log('含 status 行数:', withStatus);

    let upserted = 0;
    for (const row of rows) {
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
    console.log('upserted:', upserted);
  }

  const withStatusDb = await prisma.adCampaignDaily.count({
    where: { NOT: { campaignStatus: '' } },
  });
  console.log('库中含 status 行数:', withStatusDb);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
