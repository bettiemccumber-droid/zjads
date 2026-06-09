/**
 * 诊断 Whistles Global (157206) LH 失效佣金是否重复计数
 */
import { PrismaClient, NormalizedStatus } from '@prisma/client';
import { dedupeAffiliateOrderKey } from '../src/common/order-dedupe.util';
import { aggregateAffiliateOrdersForMonitor } from '../src/common/commission-aggregate.util';
import {
  fetchLinkHaitaoCommissions,
  normalizeLinkHaitaoOrders,
} from '../src/collectors/linkhaitao.collector';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';

dotenv.config();

const MID = '157206';
const START = '2026-05-01';
const END = '2026-05-31';

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

async function main() {
  const prisma = new PrismaClient();
  const lh = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'linkhaitao' } },
  });
  if (!lh) return console.log('无 lh 账号');

  const orders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: lh.id,
      merchantId: MID,
      orderDate: {
        gte: new Date(`${START}T00:00:00.000Z`),
        lte: new Date(`${END}T23:59:59.999Z`),
      },
    },
    orderBy: [{ orderDate: 'asc' }, { externalOrderId: 'asc' }],
    select: {
      id: true,
      externalOrderId: true,
      commission: true,
      orderAmount: true,
      normalizedStatus: true,
      rawStatus: true,
      orderDate: true,
      rawPayload: true,
    },
  });

  console.log(`merchantId=${MID} 原始行: ${orders.length}\n`);

  const byExt = new Map<string, typeof orders>();
  for (const o of orders) {
    const k = o.externalOrderId;
    if (!byExt.has(k)) byExt.set(k, []);
    byExt.get(k)!.push(o);
  }
  console.log(`唯一 externalOrderId: ${byExt.size}`);
  for (const [ext, rows] of byExt) {
    if (rows.length > 1) {
      console.log(`\n重复 externalOrderId ${ext} (${rows.length} 行):`);
      for (const r of rows) {
        console.log(
          `  id=${r.id} status=${r.normalizedStatus} comm=$${r.commission} date=${r.orderDate.toISOString().slice(0, 10)}`,
        );
      }
    }
  }

  const dedupeKeys = new Map<string, typeof orders[0]>();
  const dupKeys: string[] = [];
  for (const o of orders) {
    const dk = `${lh.id}|${dedupeAffiliateOrderKey(o.externalOrderId)}`;
    if (dedupeKeys.has(dk)) dupKeys.push(dk);
    else dedupeKeys.set(dk, o);
  }
  console.log(`\n去重后订单数(channel+dedupeKey): ${dedupeKeys.size}`);
  if (dupKeys.length) console.log('去重键冲突:', [...new Set(dupKeys)]);

  let rejComm = 0;
  let rejCount = 0;
  let totalComm = 0;
  let pendingComm = 0;
  for (const o of dedupeKeys.values()) {
    const buckets = await import('../src/common/order-commission-buckets.util').then((m) =>
      m.resolveOrderCommissionBuckets(o),
    );
    totalComm += Number(o.commission);
    pendingComm += buckets.pending;
    rejComm += buckets.rejected;
    if (buckets.rejected > 0) rejCount += 1;
  }
  console.log(`\n去重后(按子行拆分): ${rejCount}/${dedupeKeys.size} 单含拒付, 失效佣金 $${rejComm.toFixed(2)}, 待确认 $${pendingComm.toFixed(2)}, 总佣金 $${totalComm.toFixed(2)}`);
  console.log(`失效率(金额): ${totalComm > 0 ? ((rejComm / totalComm) * 100).toFixed(1) : 0}%`);

  console.log('\n全部订单明细:');
  for (const o of [...dedupeKeys.values()].sort((a, b) => a.externalOrderId.localeCompare(b.externalOrderId))) {
    console.log(
      `  ${o.externalOrderId} ${o.normalizedStatus} $${Number(o.commission).toFixed(2)} amount=$${Number(o.orderAmount).toFixed(2)} raw=${o.rawStatus}`,
    );
    if (o.rawPayload) {
      console.log(`    rawPayload:`, JSON.stringify(o.rawPayload).slice(0, 500));
    }
  }

  const allLh = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: lh.id,
      orderDate: {
        gte: new Date(`${START}T00:00:00.000Z`),
        lte: new Date(`${END}T23:59:59.999Z`),
      },
    },
    include: { channelAccount: { include: { platform: true } } },
  });
  const agg = aggregateAffiliateOrdersForMonitor(allLh).find((m) => m.merchantId === MID);
  console.log('\n监控聚合(商家+平台):', agg);

  const { apiToken } = decryptCredentials(lh.credentialsEnc);
  if (apiToken) {
    console.log('\n=== LH API 实时拉取 5 月 ===');
    const rows = await fetchLinkHaitaoCommissions(apiToken, START, END);
    const whistRows = rows.filter((r) => String(r.m_id ?? r.mcid ?? '') === MID || String(r.m_id) === MID);
    console.log(`API 总行数(全商家): ${rows.length}, Whistles 行数: ${whistRows.length}`);

    const byOrder = new Map<string, typeof whistRows>();
    for (const r of whistRows) {
      const oid = String(r.order_id ?? r.sign_id ?? '');
      if (!byOrder.has(oid)) byOrder.set(oid, []);
      byOrder.get(oid)!.push(r);
    }
    for (const [oid, lines] of [...byOrder.entries()].sort()) {
      const sumComm = lines.reduce((s, l) => s + parseFloat(String(l.cashback ?? l.commission ?? 0)), 0);
      const sumAmt = lines.reduce((s, l) => s + parseFloat(String(l.sale_amount ?? l.amount ?? 0)), 0);
      console.log(`\norder_id=${oid} API行数=${lines.length} 合计佣金=$${sumComm.toFixed(2)} 销售额=$${sumAmt.toFixed(2)}`);
      for (const l of lines) {
        console.log(
          `  sign_id=${l.sign_id?.slice(0, 8)}… cashback=${l.cashback} amount=${l.sale_amount} status=${l.status}`,
        );
      }
    }

    const mappings = await prisma.platformStatusMapping.findMany({
      where: { platformId: lh.platformId },
    });
    const normalized = normalizeLinkHaitaoOrders(whistRows, mappings);
    console.log('\nAPI 归一化后订单数:', normalized.length);
    for (const o of normalized.sort((a, b) => a.externalOrderId.localeCompare(b.externalOrderId))) {
      console.log(`  ${o.externalOrderId} ${o.normalizedStatus} $${o.commission.toFixed(2)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
