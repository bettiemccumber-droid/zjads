import { PrismaClient } from '@prisma/client';
import { ReportsService } from '../src/reports/reports.service';
import { PrismaService } from '../src/prisma/prisma.service';

const START = process.argv[2] ?? '2026-06-17';
const END = process.argv[3] ?? '2026-06-23';

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
    if (r.totals.accountLevelAdSpend != null) {
      console.log('accountLevelAdSpend:', r.totals.accountLevelAdSpend.toFixed(2));
    }
    const enabled = r.summary.filter((x) => x.campaignStatus === 'ENABLED');
    const paused = r.summary.filter((x) => x.campaignStatus !== 'ENABLED');
    console.log('ENABLED in summary:', enabled.length, 'non-ENABLED:', paused.length);
    if (statusMode === 'active' && paused.length) {
      console.log('unexpected non-ENABLED in active filter:', paused.map((x) => x.campaignName));
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
