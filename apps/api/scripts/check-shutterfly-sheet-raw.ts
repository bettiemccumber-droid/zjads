import axios from 'axios';
import { buildSheetCsvUrl } from '../src/ad-sources/sheet-parser.util';

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}

async function main() {
  const sheetId = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
  const url = buildSheetCsvUrl(sheetId, 'raw_daily_report');
  const res = await axios.get<string>(url, { timeout: 120000, responseType: 'text' });
  const lines = res.data.split('\n').filter((l) => l.trim());
  const headers = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').replace(/"/g, '').trim().toLowerCase());

  const idx = {
    date: headers.indexOf('date'),
    customerId: headers.indexOf('customer_id'),
    campaignId: headers.indexOf('campaign_id'),
    campaignName: headers.indexOf('campaign_name'),
    adId: headers.indexOf('ad_id'),
    impressions: headers.indexOf('impressions'),
    clicks: headers.indexOf('clicks'),
    cost: headers.indexOf('cost'),
    costMicros: headers.indexOf('cost_micros'),
  };

  const target = '148-lb2-Shutterfly';
  const dates = ['2026-06-05', '2026-06-06', '2026-06-07'];
  let sumImp = 0;
  let sumClk = 0;
  let sumCost = 0;
  let sumMicros = 0;
  let rowCount = 0;

  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const date = cells[idx.date]?.replace(/"/g, '');
    const name = cells[idx.campaignName]?.replace(/"/g, '') ?? '';
    if (!dates.includes(date) || !name.includes(target)) continue;
    rowCount += 1;
    const imp = parseInt(cells[idx.impressions]?.replace(/"/g, '') || '0', 10);
    const clk = parseInt(cells[idx.clicks]?.replace(/"/g, '') || '0', 10);
    const cost = parseFloat(cells[idx.cost]?.replace(/"/g, '').replace(/[$,]/g, '') || '0');
    const micros = parseInt(cells[idx.costMicros]?.replace(/"/g, '') || '0', 10);
    sumImp += imp;
    sumClk += clk;
    sumCost += cost;
    sumMicros += micros;
    console.log(
      date,
      'ad', cells[idx.adId]?.replace(/"/g, ''),
      'imp', imp,
      'clk', clk,
      'cost', cost,
      'micros', micros,
    );
  }

  console.log('---');
  console.log('ad-level rows', rowCount);
  console.log('sum imp', sumImp, 'clk', sumClk, 'cost', sumCost.toFixed(2));
  console.log('sum micros', sumMicros, '=>', Math.round(sumMicros / 10000) / 100);
}

main();
