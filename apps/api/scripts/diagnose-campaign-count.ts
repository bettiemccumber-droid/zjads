import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const start = process.argv[2] ?? '2026-05-26';
  const end = process.argv[3] ?? '2026-06-01';

  const rows = await prisma.adCampaignDaily.findMany({
    where: {
      date: { gte: new Date(start), lte: new Date(end) },
    },
    select: {
      customerId: true,
      campaignId: true,
      campaignName: true,
      cost: true,
      clicks: true,
      impressions: true,
    },
  });

  type Agg = { name: string; cost: number; clicks: number; impressions: number };
  const byCampaign = new Map<string, Agg>();

  for (const r of rows) {
    const k = `${r.customerId}|${r.campaignId}`;
    if (!byCampaign.has(k)) {
      byCampaign.set(k, { name: r.campaignName, cost: 0, clicks: 0, impressions: 0 });
    }
    const a = byCampaign.get(k)!;
    a.cost += Number(r.cost);
    a.clicks += r.clicks;
    a.impressions += r.impressions;
  }

  const all = [...byCampaign.entries()];
  const withActivity = all.filter(([, v]) => v.cost > 0 || v.clicks > 0 || v.impressions > 0);
  const zeroOnly = all.filter(([, v]) => v.cost === 0 && v.clicks === 0 && v.impressions === 0);

  console.log(`日期 ${start} ~ ${end}`);
  console.log(`Sheet 导入后唯一 Campaign 数: ${all.length}`);
  console.log(`有展示/点击/花费: ${withActivity.length}`);
  console.log(`全 0 指标: ${zeroOnly.length}`);

  console.log('\n--- 有花费或点击（与 Ads 列表更可比）---');
  for (const [, v] of withActivity.sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  $${v.cost.toFixed(2)} / ${v.clicks} clk / ${v.name.slice(0, 55)}`);
  }

  if (zeroOnly.length) {
    console.log('\n--- 全 0（可能是暂停/无流量但仍入库）---');
    for (const [, v] of zeroOnly) {
      console.log(`  ${v.name.slice(0, 60)}`);
    }
  }

  // 按名称去重看是否同一系列名多条 campaignId
  const byName = new Map<string, number>();
  for (const [, v] of all) {
    byName.set(v.name, (byName.get(v.name) ?? 0) + 1);
  }
  const dupNames = [...byName.entries()].filter(([, c]) => c > 1);
  if (dupNames.length) {
    console.log('\n--- 同名系列多条 campaignId ---');
    for (const [name, c] of dupNames) {
      console.log(`  x${c} ${name.slice(0, 50)}`);
    }
  }

  const allRows = await prisma.adCampaignDaily.findMany({
    select: { customerId: true, campaignId: true, campaignName: true, date: true },
  });
  const allKeys = new Set(allRows.map((r) => `${r.customerId}|${r.campaignId}`));
  const allDates = [...new Set(allRows.map((r) => r.date.toISOString().slice(0, 10)))].sort();
  console.log(`\n[全库] 日表行 ${allRows.length}，唯一 Campaign ${allKeys.size}，日期: ${allDates.join(', ')}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
