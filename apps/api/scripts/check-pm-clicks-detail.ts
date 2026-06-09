import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const START = '2026-05-28';
const END = '2026-06-03';

async function main() {
  const pmAccount = await prisma.channelAccount.findFirst({
    where: { affiliateAlias: 'pm2', platform: { code: 'partnermatic' } },
  });
  if (!pmAccount) {
    console.log('无 pm2 账号');
    return;
  }
  console.log('账号', pmAccount.id, pmAccount.displayName);

  const rows = await prisma.affiliateMerchantClickDaily.findMany({
    where: {
      channelAccountId: pmAccount.id,
      clickDate: { gte: new Date(START), lte: new Date(END) },
    },
    orderBy: [{ clicks: 'desc' }],
  });
  const sum = rows.reduce((s, r) => s + r.clicks, 0);
  console.log(`${START}~${END}: ${rows.length} 商家, 合计 ${sum} 点击`);
  for (const r of rows) {
    console.log(`  mid=${r.merchantId} name=${r.merchantName} ${r.clickDate.toISOString().slice(0, 10)} clicks=${r.clicks}`);
  }

  const anyPm = await prisma.affiliateMerchantClickDaily.findMany({
    where: { channelAccountId: pmAccount.id },
    orderBy: { clickDate: 'desc' },
    take: 15,
  });
  console.log('\npm2 最近点击日表（任意日期）:');
  for (const r of anyPm) {
    console.log(`  ${r.clickDate.toISOString().slice(0, 10)} mid=${r.merchantId} clicks=${r.clicks}`);
  }

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: pmAccount.id,
      merchantId: '116442',
      orderDate: {
        gte: new Date(`${START}T00:00:00.000Z`),
        lte: new Date(`${END}T23:59:59.999Z`),
      },
    },
    take: 3,
    select: { merchantId: true, merchantName: true, rawPayload: true },
  });
  console.log('\n116442 订单样本 rawPayload keys:');
  for (const o of orders) {
    const raw = o.rawPayload as Record<string, unknown>;
    console.log('  merchantName=', o.merchantName, 'brand_id=', raw?.brand_id, 'mid=', raw?.mid, 'mcid=', raw?.mcid);
  }
}

main().finally(() => prisma.$disconnect());
