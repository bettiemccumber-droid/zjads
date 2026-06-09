/**
 * 诊断商家 116442（Ticombo pm2）联盟点击是否入库
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const MID = '116442';
const START = '2026-05-28';
const END = '2026-06-03';

async function main() {
  const clicks = await prisma.affiliateMerchantClickDaily.findMany({
    where: {
      merchantId: MID,
      clickDate: { gte: new Date(START), lte: new Date(END) },
    },
    include: { channelAccount: { include: { platform: true } } },
    orderBy: { clickDate: 'asc' },
  });
  const sum = clicks.reduce((s, c) => s + c.clicks, 0);
  console.log(`merchantId=${MID} ${START}~${END}`);
  console.log(`点击日表: ${clicks.length} 行, 合计 ${sum}`);
  for (const c of clicks) {
    console.log(
      `  ${c.clickDate.toISOString().slice(0, 10)} clicks=${c.clicks} account=${c.channelAccount.displayName} (${c.channelAccount.affiliateAlias}) ${c.channelAccount.platform.code}`,
    );
  }

  const pmClicks = await prisma.affiliateMerchantClickDaily.groupBy({
    by: ['merchantId'],
    _sum: { clicks: true },
    where: {
      clickDate: { gte: new Date(START), lte: new Date(END) },
      channelAccount: { platform: { code: 'partnermatic' } },
    },
    orderBy: { _sum: { clicks: 'desc' } },
    take: 15,
  });
  console.log('\nPM 点击 TOP merchantId:');
  for (const g of pmClicks) {
    console.log(`  mid=${g.merchantId} clicks=${g._sum.clicks}`);
  }

  const near = await prisma.affiliateMerchantClickDaily.findMany({
    where: {
      clickDate: { gte: new Date(START), lte: new Date(END) },
      channelAccount: { platform: { code: 'partnermatic' } },
      OR: [
        { merchantId: { contains: '1164' } },
        { merchantName: { contains: 'Ticombo' } },
        { merchantName: { contains: 'ticombo' } },
      ],
    },
    take: 20,
  });
  console.log('\nPM 点击含 1164 / Ticombo:');
  for (const c of near) {
    console.log(`  mid=${c.merchantId} name=${c.merchantName} clicks=${c.clicks} ${c.clickDate.toISOString().slice(0, 10)}`);
  }
}

main()
  .catch((e) => console.error(e))
  .finally(() => prisma.$disconnect());
