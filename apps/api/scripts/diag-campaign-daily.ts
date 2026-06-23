import { PrismaClient } from '@prisma/client';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

const START = '2026-06-16';
const END = '2026-06-22';
const TICOMBO = 'Ticombo';

async function main() {
  const prisma = new PrismaClient();
  const reports = new ReportsService(new PrismaService());
  const user = { id: 2, role: 'OPERATOR' as const, organizationId: 1 };

  const r = await reports.campaignDaily(user, {
    startDate: START,
    endDate: END,
    statusMode: 'all',
  });

  const ticombo = r.rows.filter((x) => x.campaignName.includes(TICOMBO));
  console.log('Ticombo daily rows:', ticombo.length);
  for (const row of ticombo.sort((a, b) => b.date.localeCompare(a.date))) {
    console.log(
      row.date,
      'cost',
      row.cost.toFixed(2),
      'clicks',
      row.clicks,
      'orders',
      row.orderCount,
      'affClicks',
      row.affiliateClicks,
    );
  }

  const zeroCost = r.rows.filter((x) => x.cost === 0 && x.clicks === 0 && x.impressions === 0);
  console.log('\nAll affiliate-only zero rows:', zeroCost.length);

  await prisma.$disconnect();
}

main().catch(console.error);
