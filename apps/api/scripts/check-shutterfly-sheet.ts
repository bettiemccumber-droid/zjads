import axios from 'axios';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';

async function main() {
  const sheetId = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
  const url = buildSheetCsvUrl(sheetId, 'raw_daily_report');
  const res = await axios.get<string>(url, {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });

  const rows = parseAdSheetCsv(res.data).filter(
    (r) =>
      r.campaignName.includes('Shutterfly') &&
      r.date >= '2026-06-05' &&
      r.date <= '2026-06-07',
  );

  console.log('parsed grouped rows', rows.length);
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(
      r.date,
      r.customerId,
      r.campaignId,
      'imp', r.impressions,
      'clk', r.clicks,
      'cost', r.cost,
    );
  }

  const lines = res.data.split('\n');
  const header = lines.find((l) => l.includes('campaign_name') || l.includes('campaign name'));
  console.log('header sample', header?.slice(0, 200));

  let rawCount = 0;
  for (const line of lines) {
    if (!line.includes('Shutterfly')) continue;
    if (!line.includes('2026-06-0')) continue;
    rawCount += 1;
    if (rawCount <= 8) {
      console.log('raw line', rawCount, line.slice(0, 220));
    }
  }
  console.log('raw sheet lines for Shutterfly June', rawCount);
}

main();
