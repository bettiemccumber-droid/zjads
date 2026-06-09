import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

async function main() {
  const prisma = new PrismaService();
  const reports = new ReportsService(prisma);
  const user = { id: 2, role: 'OPERATOR' as const, organizationId: 1 };

  const result = await reports.campaignDaily(user, {
    startDate: '2026-06-01',
    endDate: '2026-06-07',
    statusMode: 'active',
  });

  const rows = result.rows.filter((r) => r.campaignName.includes('148-lb2-Shutterfly'));
  console.log('shutterfly daily rows', rows.length);
  for (const r of rows.sort((a, b) => a.date.localeCompare(b.date))) {
    console.log(
      r.date,
      'cost', r.cost,
      'orders', r.orderCount,
      'commission', r.commission,
      'affClicks', r.affiliateClicks,
    );
  }

  await prisma.$disconnect();
}

main();
