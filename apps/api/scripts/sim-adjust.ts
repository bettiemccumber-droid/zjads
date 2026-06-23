import axios from 'axios';
import {
  ACCOUNT_DAILY_COST_TAB,
  ACCOUNT_GAP_CAMPAIGN_ID,
  applyAccountCostAdjustment,
  buildSheetCsvUrl,
  parseAccountDailyCostCsv,
  parseAdSheetCsv,
} from '../src/ad-sources/sheet-parser.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const START = '2026-06-01';
const END = '2026-06-17';

async function main() {
  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const rows = parseAdSheetCsv(res.data).filter((r) => r.date >= START && r.date <= END);
  const detailBefore = rows.reduce((s, r) => s + r.cost, 0);

  const ares = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, ACCOUNT_DAILY_COST_TAB), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const acct = parseAccountDailyCostCsv(ares.data).filter(
    (r) => r.date >= START && r.date <= END,
  );
  const accountTotal = acct.reduce((s, r) => s + r.cost, 0);

  const adj = applyAccountCostAdjustment(rows, acct);
  const detailAfter = adj.rows.reduce((s, r) => s + r.cost, 0);

  console.log('detail before:', detailBefore.toFixed(2));
  console.log('account total:', accountTotal.toFixed(2));
  console.log('after adjustment:', detailAfter.toFixed(2));
  console.log('adjustment delta:', adj.totalAdjustment.toFixed(2));
  console.log('gap rows:', adj.rows.filter((r) => r.campaignId === ACCOUNT_GAP_CAMPAIGN_ID).length);
}

main().catch(console.error);
