import axios from 'axios';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';

async function main() {
  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const rows = parseAdSheetCsv(res.data);
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  console.log('sheet date range:', dates[0], '~', dates[dates.length - 1]);
  for (const d of ['2026-06-16', '2026-06-17', '2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22']) {
    const day = rows.filter((r) => r.date === d);
    console.log(d, 'rows:', day.length, 'cost:', day.reduce((s, r) => s + r.cost, 0).toFixed(2));
  }
}

main().catch(console.error);
