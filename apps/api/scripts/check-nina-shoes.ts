import axios from 'axios';
import { buildSheetCsvUrl, parseAdSheetCsv } from '../src/ad-sources/sheet-parser.util';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';

async function main() {
  const url = buildSheetCsvUrl(SHEET_ID, 'raw_daily_report');
  const res = await axios.get<string>(url, {
    responseType: 'text',
    timeout: 120000,
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const rows = parseAdSheetCsv(res.data);

  for (const kw of ['1998', 'Nina', '137-lh2']) {
    const matched = rows.filter(
      (r) =>
        r.campaignName.toLowerCase().includes(kw.toLowerCase()) || r.merchantId === kw,
    );
    const names = [...new Set(matched.map((r) => r.campaignName))];
    console.log(`\nSheet "${kw}": ${matched.length} 行, 系列:`, names);
    const inRange = matched.filter((r) => r.date >= '2026-05-28' && r.date <= '2026-06-03');
    if (inRange.length) {
      const clicks = inRange.reduce((s, r) => s + r.clicks, 0);
      const cost = inRange.reduce((s, r) => s + r.cost, 0);
      console.log(`  2026-05-28~06-03: ${inRange.length} 行, 点击 ${clicks}, 花费 $${cost.toFixed(2)}`);
    } else if (matched.length) {
      console.log('  日期样本:', [...new Set(matched.map((r) => r.date))].sort().slice(0, 8));
    }
  }

  const db = await prisma.adCampaignDaily.findMany({
    where: {
      OR: [
        { merchantId: '1998' },
        { campaignName: { contains: '1998' } },
        { campaignName: { contains: 'Nina' } },
      ],
    },
    select: {
      campaignName: true,
      date: true,
      clicks: true,
      cost: true,
      impressions: true,
      campaignStatus: true,
    },
    orderBy: { date: 'asc' },
  });
  console.log('\nZJADS DB Nina/1998 行数:', db.length);
  for (const r of db) {
    console.log(
      `  ${r.date.toISOString().slice(0, 10)} | ${r.campaignName} | impr ${r.impressions} clicks ${r.clicks} $${Number(r.cost).toFixed(2)} | ${r.campaignStatus}`,
    );
  }

  console.log('\nSheet 明细:');
  const nina = rows.filter((r) => r.campaignName.includes('1998'));
  for (const r of nina.sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(
      `  ${r.date} | impr ${r.impressions} clicks ${r.clicks} $${r.cost.toFixed(2)} | ${r.campaignStatus}`,
    );
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
