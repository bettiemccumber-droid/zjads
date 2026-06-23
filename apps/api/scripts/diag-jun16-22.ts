import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import {
  ACCOUNT_DAILY_COST_TAB,
  ACCOUNT_GAP_CAMPAIGN_ID,
  applyAccountCostAdjustment,
  buildSheetCsvUrl,
  parseAccountDailyCostCsv,
  parseAdSheetCsv,
} from '../src/ad-sources/sheet-parser.util';
import { isEnabledCampaignStatus } from '../src/common/campaign-status.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const OWNER_USER_ID = 2;
const START = '2026-06-16';
const END = '2026-06-22';

async function main() {
  const prisma = new PrismaClient();

  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  let sheetRows = parseAdSheetCsv(res.data).filter((r) => r.date >= START && r.date <= END);
  const detailBefore = sheetRows.reduce((s, r) => s + r.cost, 0);
  const enabledBefore = sheetRows
    .filter((r) => isEnabledCampaignStatus(r.campaignStatus))
    .reduce((s, r) => s + r.cost, 0);

  const ares = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, ACCOUNT_DAILY_COST_TAB), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const acct = parseAccountDailyCostCsv(ares.data).filter(
    (r) => r.date >= START && r.date <= END,
  );
  const accountTotal = acct.reduce((s, r) => s + r.cost, 0);
  const adj = applyAccountCostAdjustment(sheetRows, acct);
  sheetRows = adj.rows;
  const detailAfter = sheetRows.reduce((s, r) => s + r.cost, 0);
  const enabledAfter = sheetRows
    .filter((r) => isEnabledCampaignStatus(r.campaignStatus))
    .reduce((s, r) => s + r.cost, 0);
  const gapCost = sheetRows
    .filter((r) => r.campaignId === ACCOUNT_GAP_CAMPAIGN_ID)
    .reduce((s, r) => s + r.cost, 0);

  console.log('=== Sheet Jun 16-22 ===');
  console.log('detail before adjust:', detailBefore.toFixed(2));
  console.log('enabled before adjust:', enabledBefore.toFixed(2));
  console.log('account daily total:', accountTotal.toFixed(2));
  console.log('detail after adjust:', detailAfter.toFixed(2));
  console.log('enabled after adjust:', enabledAfter.toFixed(2));
  console.log('gap rows cost:', gapCost.toFixed(2));

  const dbRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: OWNER_USER_ID,
      date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
    },
  });
  const dbTotal = dbRows.reduce((s, r) => s + Number(r.cost), 0);
  const dbEnabled = dbRows
    .filter((r) => isEnabledCampaignStatus(r.campaignStatus))
    .reduce((s, r) => s + Number(r.cost), 0);
  const dbGap = dbRows
    .filter((r) => r.campaignId === ACCOUNT_GAP_CAMPAIGN_ID)
    .reduce((s, r) => s + Number(r.cost), 0);
  const dates = [...new Set(dbRows.map((r) => r.date.toISOString().slice(0, 10)))].sort();

  console.log('\n=== DB Jun 16-22 ===');
  console.log('rows:', dbRows.length, 'dates:', dates.join(', '));
  console.log('db total:', dbTotal.toFixed(2));
  console.log('db enabled:', dbEnabled.toFixed(2));
  console.log('db gap:', dbGap.toFixed(2));

  await prisma.$disconnect();
}

main().catch(console.error);
