import axios from 'axios';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';

async function main() {
  const url = buildSheetCsvUrl(SHEET_ID, 'raw_daily_report');
  const res = await axios.get<string>(url, { responseType: 'text' });
  const rows = parseAdSheetCsv(res.data);

  for (const kw of ['91322', 'wherelight', '136-lh2']) {
    const matched = rows.filter(
      (r) => r.campaignName.toLowerCase().includes(kw.toLowerCase()) || r.merchantId === kw,
    );
    const names = [...new Set(matched.map((r) => r.campaignName))];
    console.log(`\nSheet "${kw}": ${matched.length} 行, 系列:`, names);
    const inRange = matched.filter((r) => r.date >= '2026-05-27' && r.date <= '2026-06-02');
    if (inRange.length) {
      const cost = inRange.reduce((s, r) => s + r.cost, 0);
      const clicks = inRange.reduce((s, r) => s + r.clicks, 0);
      console.log(`  2026-05-27~06-02: ${inRange.length} 行, 点击 ${clicks}, 花费 $${cost.toFixed(2)}`);
      for (const d of [...new Set(inRange.map((r) => r.date))].sort()) {
        const day = inRange.filter((r) => r.date === d);
        console.log(
          `    ${d}: ${day.reduce((s, r) => s + r.clicks, 0)} 点击 $${day.reduce((s, r) => s + r.cost, 0).toFixed(2)}`,
        );
      }
    }
  }

  const db = await prisma.adCampaignDaily.findMany({
    where: {
      OR: [{ campaignName: { contains: '91322' } }, { merchantId: '91322' }],
    },
    select: { campaignName: true, date: true, clicks: true, cost: true },
    orderBy: { date: 'asc' },
  });
  console.log('\nZJADS DB wherelight/91322 行数:', db.length);
  if (db.length) {
    const names = [...new Set(db.map((r) => r.campaignName))];
    console.log('  系列:', names);
    const inRange = db.filter(
      (r) => r.date >= new Date('2026-05-27') && r.date <= new Date('2026-06-02'),
    );
    console.log('  5/27-6/2 行数:', inRange.length);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
