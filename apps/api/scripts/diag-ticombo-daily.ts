import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';
import { parseCampaignName } from '../src/common/campaign-name.util';
import { resolveCampaignGroupKey } from '../src/common/campaign-group.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const CAMPAIGN = 'Ticombo';
const START = '2026-06-16';
const END = '2026-06-22';
const OWNER = 2;

async function main() {
  const prisma = new PrismaClient();

  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const allSheet = parseAdSheetCsv(res.data).filter((r) => r.campaignName.includes(CAMPAIGN));
  console.log('\n=== Sheet all dates ===', allSheet.length, 'rows');
  for (const r of allSheet.sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(r.date, r.cost.toFixed(2), r.clicks, r.customerId);
  }

  const sheet = allSheet.filter((r) => r.date >= START && r.date <= END);
  console.log('=== Sheet ===');
  for (const r of sheet.sort((a, b) => a.date.localeCompare(b.date))) {
    const parsed = parseCampaignName(r.campaignName);
    const key = resolveCampaignGroupKey({
      campaignName: r.campaignName,
      merchantId: r.merchantId || parsed.merchantId,
      affiliateAlias: r.affiliateAlias || parsed.affiliateAlias,
      customerId: r.customerId,
      campaignId: r.campaignId,
    });
    console.log(r.date, r.cost.toFixed(2), r.clicks, r.customerId, key);
  }
  console.log('sheet total:', sheet.reduce((s, r) => s + r.cost, 0).toFixed(2));

  const db = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: OWNER,
      date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
      campaignName: { contains: CAMPAIGN },
    },
    orderBy: { date: 'asc' },
  });
  console.log('\n=== DB ===');
  for (const r of db) {
    const parsed = parseCampaignName(r.campaignName);
    const key = resolveCampaignGroupKey({
      campaignName: r.campaignName,
      merchantId: r.merchantId || parsed.merchantId,
      affiliateAlias: r.affiliateAlias || parsed.affiliateAlias,
      customerId: r.customerId,
      campaignId: r.campaignId,
    });
    console.log(
      r.date.toISOString().slice(0, 10),
      Number(r.cost).toFixed(2),
      r.clicks,
      r.customerId,
      key,
    );
  }
  console.log('db total:', db.reduce((s, r) => s + Number(r.cost), 0).toFixed(2));

  await prisma.$disconnect();
}

main().catch(console.error);
