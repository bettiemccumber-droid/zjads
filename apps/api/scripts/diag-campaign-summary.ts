import { PrismaClient } from '@prisma/client';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

const START = '2026-06-16';
const END = '2026-06-22';

async function main() {
  const prisma = new PrismaClient();
  const reports = new ReportsService(new PrismaService());
  const user = { id: 2, role: 'OPERATOR' as const, organizationId: 1 };

  for (const statusMode of ['active', 'all'] as const) {
    const r = await reports.campaignSummary(user, { startDate: START, endDate: END, statusMode });
    const rowSum = r.summary.reduce((s, x) => s + x.cost, 0);
    console.log(`\n=== statusMode=${statusMode} ===`);
    console.log('rows:', r.summary.length);
    console.log('row sum:', rowSum.toFixed(2));
    console.log('totals.cost (card):', r.totals.cost.toFixed(2));
    console.log('campaignDetailSpend:', r.totals.campaignDetailSpend?.toFixed(2));
    console.log('adSpendSource:', r.totals.adSpendSource);
  }

  await prisma.$disconnect();
}

main().catch(console.error);
