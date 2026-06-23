import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import {
  ACCOUNT_DAILY_COST_TAB,
  buildSheetCsvUrl,
  parseAccountDailyCostCsv,
  parseAdSheetCsv,
} from '../src/ad-sources/sheet-parser.util';

const SHEET_ID = '18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4';
const START = '2026-06-01';
const END = '2026-06-17';

async function main() {
  const prisma = new PrismaClient();

  const res = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, 'raw_daily_report'), {
    timeout: 120000,
    responseType: 'text',
    headers: { 'User-Agent': 'ZJADS/1.0' },
  });
  const allRows = parseAdSheetCsv(res.data);
  const rows = allRows.filter((r) => r.date >= START && r.date <= END);
  const sheetTotal = rows.reduce((s, r) => s + r.cost, 0);

  console.log('=== Sheet raw_daily_report ===');
  console.log('All parsed rows:', allRows.length);
  console.log(`${START}~${END} rows:`, rows.length);
  console.log(`${START}~${END} cost sum:`, sheetTotal.toFixed(2));

  const byCustomer = new Map<string, number>();
  for (const r of rows) {
    byCustomer.set(r.customerId, (byCustomer.get(r.customerId) ?? 0) + r.cost);
  }
  console.log('By customer_id:', [...byCustomer.entries()].sort((a, b) => b[1] - a[1]));

  console.log('\n=== DB ad_campaign_daily ===');
  const users = await prisma.user.findMany({
    select: { id: true, username: true },
    orderBy: { id: 'asc' },
  });
  for (const u of users) {
    const grouped = await prisma.adCampaignDaily.groupBy({
      by: ['customerId'],
      where: {
        ownerUserId: u.id,
        date: { gte: new Date(START), lte: new Date(`${END}T23:59:59.999Z`) },
      },
      _sum: { cost: true },
      _count: { _all: true },
    });
    if (!grouped.length) continue;
    const total = grouped.reduce((s, g) => s + Number(g._sum.cost ?? 0), 0);
    console.log(`${u.username} (id=${u.id}): $${total.toFixed(2)}, customers:`, grouped.length);
    for (const g of grouped.sort((a, b) => Number(b._sum.cost) - Number(a._sum.cost))) {
      console.log(`  ${g.customerId}: $${Number(g._sum.cost).toFixed(2)} (${g._count._all} rows)`);
    }
  }

  try {
    const ares = await axios.get<string>(buildSheetCsvUrl(SHEET_ID, ACCOUNT_DAILY_COST_TAB), {
      timeout: 120000,
      responseType: 'text',
      headers: { 'User-Agent': 'ZJADS/1.0' },
    });
    const acct = parseAccountDailyCostCsv(ares.data).filter(
      (r) => r.date >= START && r.date <= END,
    );
    console.log('\n=== Sheet raw_daily_account_cost ===');
    console.log('Rows:', acct.length);
    console.log('Cost sum:', acct.reduce((s, r) => s + r.cost, 0).toFixed(2));
  } catch {
    console.log('\n=== raw_daily_account_cost: missing or unreadable ===');
  }

  await prisma.$disconnect();
}

main().catch(console.error);
