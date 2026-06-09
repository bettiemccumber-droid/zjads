import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.channelAccount.findMany({
    select: { id: true, displayName: true, affiliateAlias: true, ownerUserId: true },
  });
  const orderCount = await prisma.affiliateOrder.count();
  const clickCount = await prisma.affiliateMerchantClickDaily.count();
  const adCount = await prisma.adCampaignDaily.count();

  console.log('=== 渠道账号 ===');
  for (const a of accounts) {
    console.log(`  #${a.id} ${a.displayName} alias=${a.affiliateAlias || '(空)'} owner=${a.ownerUserId}`);
  }

  console.log('\n=== 数据量 ===');
  console.log(`订单: ${orderCount}, 联盟点击日表: ${clickCount}, 广告日表: ${adCount}`);

  if (orderCount > 0) {
    const orders = await prisma.affiliateOrder.findMany({
      take: 5,
      include: { channelAccount: { select: { affiliateAlias: true } } },
      orderBy: { orderDate: 'desc' },
    });
    console.log('\n=== 最近订单样本 ===');
    for (const o of orders) {
      console.log(
        `  merchantId=${o.merchantId} alias=${o.channelAccount.affiliateAlias} comm=${o.commission} date=${o.orderDate.toISOString().slice(0, 10)}`,
      );
    }

    const byKey = await prisma.$queryRaw<
      { merchant_id: string; alias: string; cnt: bigint }[]
    >`
      SELECT o.merchant_id, LOWER(ca.affiliate_alias) as alias, COUNT(*) as cnt
      FROM affiliate_orders o
      JOIN channel_accounts ca ON ca.id = o.channel_account_id
      GROUP BY o.merchant_id, ca.affiliate_alias
      ORDER BY cnt DESC
      LIMIT 15
    `;
    console.log('\n=== 订单 merchant|alias TOP ===');
    for (const r of byKey) {
      console.log(`  ${r.merchant_id}|${r.alias} → ${r.cnt} 单`);
    }
  }

  if (adCount > 0) {
    const checkIds = ['65835', '116017'];
    for (const mid of checkIds) {
      const byField = await prisma.adCampaignDaily.count({ where: { merchantId: mid } });
      const byName = await prisma.adCampaignDaily.count({
        where: { campaignName: { contains: mid } },
      });
      console.log(`\n=== 广告数据 merchant ${mid}: id字段=${byField} 名称含=${byName} ===`);
      if (byName > 0) {
        const samples = await prisma.adCampaignDaily.findMany({
          where: { campaignName: { contains: mid } },
          take: 3,
          select: { campaignName: true, cost: true, date: true, merchantId: true },
        });
        for (const s of samples) {
          console.log(`  ${s.date.toISOString().slice(0, 10)} $${s.cost} ${s.campaignName.slice(0, 55)} storedMid=${s.merchantId}`);
        }
      }
    }

    const campaigns = await prisma.adCampaignDaily.findMany({
      distinct: ['campaignId'],
      select: { campaignName: true, merchantId: true, affiliateAlias: true },
      take: 15,
    });
    console.log('\n=== 广告系列解析键 ===');
    for (const c of campaigns) {
      const parsed = parseCampaignName(c.campaignName);
      const mid = c.merchantId || parsed.merchantId;
      const alias = (c.affiliateAlias || parsed.affiliateAlias).toLowerCase();
      console.log(`  ${mid}|${alias} ← ${c.campaignName.slice(0, 50)}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
