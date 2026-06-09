import axios from 'axios';
import { parseAdSheetCsv, buildSheetCsvUrl } from '../src/ad-sources/sheet-parser.util';
import { PrismaClient } from '@prisma/client';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const prisma = new PrismaClient();

async function main() {
  const url = buildSheetCsvUrl(SHEET_ID, 'raw_daily_report');
  console.log('Fetching', url);
  const res = await axios.get<string>(url, {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const lines = res.data.split('\n');
  console.log('CSV lines:', lines.length);
  console.log('Header:', lines[0]?.slice(0, 300));

  const rows = parseAdSheetCsv(res.data);
  console.log('Parsed rows:', rows.length);
  if (rows.length) {
    console.log('Date range:', rows.map((r) => r.date).sort()[0], '~', rows.map((r) => r.date).sort().slice(-1)[0]);
  }

  const keywords = ['146792', 'COSMO', '561-241-4329', '083-lh2', 'CRAVOT', 'Murci'];
  for (const kw of keywords) {
    const matched = rows.filter(
      (r) =>
        r.campaignName.includes(kw) ||
        r.customerId.includes(kw) ||
        r.merchantId.includes(kw),
    );
    const campaigns = [...new Set(matched.map((r) => r.campaignName))];
    console.log(`\n"${kw}": ${matched.length} rows, ${campaigns.length} campaigns`);
    for (const c of campaigns.slice(0, 5)) console.log(' ', c);
  }

  const customerIds = [...new Set(rows.map((r) => r.customerId))].sort();
  console.log('\nSheet customer_id 共', customerIds.length);
  console.log('含 561-241-4329:', customerIds.includes('561-241-4329'));
  console.log('含 232-931-1942:', customerIds.includes('232-931-1942'));

  const inRange = rows.filter((r) => r.date >= '2026-05-27' && r.date <= '2026-06-02');
  console.log('\n2026-05-27~06-02 行数:', inRange.length);
  const lhInRange = inRange.filter((r) => r.affiliateAlias.startsWith('lh'));
  console.log('其中 lh 系列:', lhInRange.length, '个系列', new Set(lhInRange.map((r) => r.campaignName)).size);

  const dbCustomers = await prisma.adCampaignDaily.groupBy({ by: ['customerId'], _count: true });
  const sheetSet = new Set(customerIds);
  const dbSet = new Set(dbCustomers.map((c) => c.customerId));
  const inSheetNotDb = customerIds.filter((id) => !dbSet.has(id));
  const inDbNotSheet = [...dbSet].filter((id) => !sheetSet.has(id));

  console.log('\nDB customer_id 共', dbCustomers.length);
  console.log('Sheet有、DB无:', inSheetNotDb.length, inSheetNotDb.slice(0, 10));
  console.log('DB有、Sheet解析无:', inDbNotSheet.length);

  // Raw CSV search
  for (const kw of ['COSMO', '146792', '083-lh2']) {
    const raw = lines.filter((l) => l.includes(kw));
    console.log(`\n原始 CSV "${kw}": ${raw.length} 行`);
    if (raw[0]) console.log('  样本:', raw[0].slice(0, 220));
  }

  const asCustomerId = lines.filter((l) => {
    const parts = l.match(/^"([^"]*)","([^"]*)"/);
    return parts?.[2] === '561-241-4329';
  });
  console.log('\ncustomer_id=561-241-4329 的行数:', asCustomerId.length);
  if (asCustomerId[0]) console.log('  样本:', asCustomerId[0].slice(0, 220));

  const mccOnly = lines.filter((l) => l.includes('"561-241-4329"')).length;
  console.log('mcc_id 列含 561-241-4329 的行数:', mccOnly, '(这是 MCC 编号，不是 customer_id)');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
