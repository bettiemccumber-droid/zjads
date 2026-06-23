import axios from 'axios';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';
import { parseCampaignName } from '../src/common/campaign-name.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const MERCHANT = '116442';
const START = '2026-06-16';
const END = '2026-06-22';

async function main() {
  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const rows = parseAdSheetCsv(res.data).filter((r) => {
    if (r.date < START || r.date > END) return false;
    const p = parseCampaignName(r.campaignName);
    return (r.merchantId || p.merchantId) === MERCHANT || r.campaignName.includes('Ticombo');
  });
  console.log('rows:', rows.length);
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date) || a.campaignName.localeCompare(b.campaignName))) {
    console.log(r.date, r.cost.toFixed(2), r.clicks, r.customerId, r.campaignName);
  }
}

main().catch(console.error);
