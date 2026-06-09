/**
 * 核实 LinkBux (lb2) 采集数据与各报表口径
 */
import { PrismaClient } from '@prisma/client';
import { parseCampaignName } from '../src/common/campaign-name.util';
import { dedupeAffiliateOrderKey } from '../src/common/order-dedupe.util';
import { isEnabledCampaignStatus } from '../src/common/campaign-status.util';
import {
  fetchLinkBuxOrders,
  summarizeLbTransactionApi,
} from '../src/collectors/linkbux.collector';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

dotenv.config();

const prisma = new PrismaClient();

/** 与 CryptoService 一致的 AES-256-GCM 解密 */
function decryptCredentials(payload: string): { apiToken?: string } {
  const hex = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const key = Buffer.from(hex, 'hex');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

const START = '2026-05-28';
const END = '2026-06-03';

async function main() {
  const lb = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkbux' } },
    include: { platform: true },
  });
  if (!lb) {
    console.log('未找到 lb2 账号');
    return;
  }

  const ownerId = lb.ownerUserId;
  console.log(`账号: ${lb.displayName} (${lb.affiliateAlias})`);
  console.log(`区间: ${START} ~ ${END}\n`);

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: lb.id,
      orderDate: {
        gte: new Date(`${START}T00:00:00.000Z`),
        lte: new Date(`${END}T23:59:59.999Z`),
      },
    },
    select: {
      externalOrderId: true,
      merchantId: true,
      merchantName: true,
      commission: true,
      normalizedStatus: true,
      orderDate: true,
    },
  });

  const dedupeMap = new Map<string, number>();
  let dbCommission = 0;
  for (const o of orders) {
    const key = `${lb.id}|${dedupeAffiliateOrderKey(o.externalOrderId)}`;
    if (!dedupeMap.has(key)) dedupeMap.set(key, 0);
    dedupeMap.set(key, dedupeMap.get(key)! + Number(o.commission));
    dbCommission += Number(o.commission);
  }

  console.log('=== 数据库（商家汇总口径）===');
  console.log(`行数: ${orders.length}`);
  console.log(`去重订单: ${dedupeMap.size}`);
  console.log(`佣金合计: $${dbCommission.toFixed(2)}`);

  const byStatus = { approved: 0, pending: 0, rejected: 0, unknown: 0 };
  const commByStatus = { approved: 0, pending: 0, rejected: 0, unknown: 0 };
  const seenKey = new Set<string>();
  for (const o of orders) {
    const key = `${lb.id}|${dedupeAffiliateOrderKey(o.externalOrderId)}`;
    if (seenKey.has(key)) continue;
    seenKey.add(key);
    const st = o.normalizedStatus as keyof typeof byStatus;
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    commByStatus[st] = (commByStatus[st] ?? 0) + Number(o.commission);
  }
  console.log('按状态去重订单:', byStatus);
  console.log('按状态佣金:', Object.fromEntries(
    Object.entries(commByStatus).map(([k, v]) => [k, `$${v.toFixed(2)}`]),
  ));

  const cred = await prisma.channelAccount.findUnique({
    where: { id: lb.id },
    select: { credentialsEnc: true },
  });
  if (cred?.credentialsEnc && process.env.CREDENTIALS_ENCRYPTION_KEY) {
    try {
      const { apiToken } = decryptCredentials(cred.credentialsEnc);
      if (apiToken) {
        console.log('\n=== 实时 API 复拉 ===');
        const raw = await fetchLinkBuxOrders(apiToken, START, END);
        const apiSum = summarizeLbTransactionApi(raw);
        console.log(`API 原始行: ${apiSum.apiListRows}`);
        console.log(`API 合并订单: ${apiSum.orderCount} 单 / $${apiSum.totalCommission.toFixed(2)}`);
      }
    } catch (e) {
      console.log('\n（API 复拉跳过:', e instanceof Error ? e.message : e, '）');
    }
  }

  const adRows = await prisma.adCampaignDaily.findMany({
    where: {
      ownerUserId: ownerId,
      date: { gte: new Date(START), lte: new Date(END) },
    },
    select: { campaignName: true, merchantId: true, affiliateAlias: true, campaignStatus: true },
  });

  const lbAds = adRows.filter((ad) => {
    const p = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || p.affiliateAlias || '').toLowerCase();
    return alias.startsWith('lb');
  });

  const campaignKeys = new Set<string>();
  const midsWithCampaign = new Set<string>();
  for (const ad of lbAds) {
    const p = parseCampaignName(ad.campaignName);
    const alias = (ad.affiliateAlias || p.affiliateAlias || '').toLowerCase();
    const mid = ad.merchantId || p.merchantId;
    campaignKeys.add(`${ad.campaignName}|${mid}`);
    if (mid) midsWithCampaign.add(`${mid}|${alias}`);
  }

  console.log('\n=== 广告系列（Sheet 导入）===');
  console.log(`lb 系列 DB 行: ${lbAds.length}`);
  console.log(`唯一系列名: ${new Set(lbAds.map((a) => a.campaignName)).size}`);

  const orderByMid = new Map<string, { count: number; comm: number; name: string }>();
  const countedKeys = new Set<string>();
  for (const o of orders) {
    const dk = dedupeAffiliateOrderKey(o.externalOrderId);
    const key = `${lb.id}|${dk}`;
    if (countedKeys.has(key)) continue;
    countedKeys.add(key);
    const mid = o.merchantId ?? '';
    const cur = orderByMid.get(mid) ?? { count: 0, comm: 0, name: o.merchantName ?? '' };
    cur.count += 1;
    cur.comm += Number(o.commission);
    if (o.merchantName) cur.name = o.merchantName;
    orderByMid.set(mid, cur);
  }

  let orphanOrders = 0;
  let orphanComm = 0;
  const orphanMerchants: Array<{ mid: string; name: string; count: number; comm: number }> = [];

  for (const [mid, v] of orderByMid) {
    const hasCampaign = midsWithCampaign.has(`${mid}|lb2`) ||
      [...midsWithCampaign].some((k) => k.startsWith(`${mid}|`));
    if (!hasCampaign) {
      orphanOrders += v.count;
      orphanComm += v.comm;
      orphanMerchants.push({ mid, name: v.name, count: v.count, comm: v.comm });
    }
  }

  orphanMerchants.sort((a, b) => b.count - a.count);
  console.log('\n=== 归因缺口（有订单无 lb 广告系列）===');
  console.log(`孤儿订单: ${orphanOrders} 单 / $${orphanComm.toFixed(2)}`);
  console.log('Top 孤儿商家:');
  for (const m of orphanMerchants.slice(0, 10)) {
    console.log(`  mid=${m.mid} ${m.name}: ${m.count} 单 / $${m.comm.toFixed(2)}`);
  }

  const campaignMap = new Map<string, { name: string; status: string; mid: string; orders: number; comm: number }>();
  for (const ad of lbAds) {
    const p = parseCampaignName(ad.campaignName);
    const key = ad.campaignName;
    const mid = ad.merchantId || p.merchantId;
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        name: ad.campaignName,
        status: ad.campaignStatus ?? '',
        mid,
        orders: 0,
        comm: 0,
      });
    }
  }

  for (const [mid, v] of orderByMid) {
    for (const c of campaignMap.values()) {
      if (c.mid === mid) {
        c.orders = v.count;
        c.comm = v.comm;
      }
    }
  }

  const allCampaigns = [...campaignMap.values()];
  const hideIdle = allCampaigns.filter(
    (r) => isEnabledCampaignStatus(r.status) || r.orders > 0 || r.comm > 0,
  );
  const enabledOnly = hideIdle.filter((r) => isEnabledCampaignStatus(r.status));

  const sum = (rows: typeof allCampaigns) =>
    rows.reduce(
      (a, r) => ({ orders: a.orders + r.orders, comm: a.comm + r.comm }),
      { orders: 0, comm: 0 },
    );

  console.log('\n=== 广告系列表模拟（lb 平台）===');
  console.log(`全部系列: ${allCampaigns.length} 条, ${sum(allCampaigns).orders} 单 / $${sum(allCampaigns).comm.toFixed(2)}`);
  console.log(`hideIdlePaused: ${hideIdle.length} 条, ${sum(hideIdle).orders} 单 / $${sum(hideIdle).comm.toFixed(2)}`);
  console.log(`+ enabledOnly: ${enabledOnly.length} 条, ${sum(enabledOnly).orders} 单 / $${sum(enabledOnly).comm.toFixed(2)}`);

  const dupRows = orders.length - dedupeMap.size;
  if (dupRows > 0) {
    console.log(`\n⚠ DB 重复 externalOrderId 行: ${dupRows}`);
  }

  const latestJob = await prisma.syncJobItem.findFirst({
    where: { channelAccountId: lb.id },
    orderBy: { id: 'desc' },
    select: {
      ordersFetched: true,
      ordersInserted: true,
      errorMessage: true,
      syncJob: { select: { startDate: true, endDate: true } },
    },
  });
  if (latestJob) {
    console.log('\n=== 最近采集任务 ===');
    console.log(
      `区间 ${latestJob.syncJob.startDate.toISOString().slice(0, 10)} ~ ${latestJob.syncJob.endDate.toISOString().slice(0, 10)}`,
    );
    console.log(`拉取 ${latestJob.ordersFetched} / 新增 ${latestJob.ordersInserted}`);
    console.log(`说明: ${latestJob.errorMessage ?? '—'}`);
  }

  await diagnoseApiDbGap(lb.id);
}

async function diagnoseApiDbGap(accountId: number) {
  const dbAll = await prisma.affiliateOrder.findMany({
    where: { channelAccountId: accountId },
    select: { externalOrderId: true, orderDate: true, commission: true, merchantName: true },
  });

  const inRange = (d: Date) => {
    const s = d.toISOString().slice(0, 10);
    return s >= START && s <= END;
  };

  const inRangeRows = dbAll.filter((o) => inRange(o.orderDate));
  const outRangeRows = dbAll.filter((o) => !inRange(o.orderDate));
  const commIn = inRangeRows.reduce((s, o) => s + Number(o.commission), 0);
  const commOut = outRangeRows.reduce((s, o) => s + Number(o.commission), 0);

  console.log('\n=== 412 vs 399 差异分析（仅 DB）===');
  console.log(`DB 总行: ${dbAll.length} | 区间内: ${inRangeRows.length} | 区间外: ${outRangeRows.length}`);
  console.log(`区间内佣金: $${commIn.toFixed(2)} | 区间外: $${commOut.toFixed(2)}`);
  console.log(
    '采集任务「412 单」为 API 按交易日期筛选；商家汇总「399 单」为 DB orderDate 落在查询区间内。',
  );
  console.log(
    `差额 ${412 - inRangeRows.length} 单 / $${(669.5 - commIn).toFixed(2)}：API 命中但 orderDate 解析后不在区间内，或唯一键冲突未覆盖入库。`,
  );

  if (outRangeRows.length > 0) {
    console.log('区间外样例:');
    for (const o of outRangeRows.slice(0, 5)) {
      console.log(
        `  ${o.externalOrderId} | ${o.orderDate.toISOString().slice(0, 10)} | $${Number(o.commission).toFixed(2)} | ${o.merchantName}`,
      );
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
