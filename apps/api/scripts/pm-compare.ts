/**
 * 对比 PM transaction API 与数据库汇总（本地诊断用）
 * 用法: npx ts-node scripts/pm-compare.ts 2026-05-26 2026-06-01
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

function decrypt(cipherB64: string, hexKey: string) {
  const key = Buffer.from(hexKey, 'hex');
  const buf = Buffer.from(cipherB64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(dec) as { apiToken?: string };
}

function parsePmOrderDate(orderTime: string | number | undefined): string {
  if (!orderTime) return '';
  if (typeof orderTime === 'string' && orderTime.includes('-')) {
    return orderTime.split(' ')[0];
  }
  const ts = (typeof orderTime === 'number' ? orderTime : parseInt(String(orderTime), 10)) * 1000;
  const d = new Date(ts + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function sumComm(orders: Record<string, unknown>[], mode: 'lines' | 'oid') {
  let lineComm = 0;
  let lineCount = 0;
  const byOid = new Map<string, number>();

  for (const order of orders) {
    const items = (order.items as Record<string, unknown>[] | undefined)?.length
      ? (order.items as Record<string, unknown>[])
      : [order];
    for (const item of items) {
      const c = parseFloat(String(item.sale_comm ?? 0)) || 0;
      lineComm += c;
      lineCount += 1;
      const oid = String(order.oid ?? order.order_id ?? '');
      if (oid) byOid.set(oid, (byOid.get(oid) ?? 0) + c);
    }
  }

  const oidComm = [...byOid.values()].reduce((a, b) => a + b, 0);
  return {
    lineComm,
    lineCount,
    oidComm,
    oidCount: byOid.size,
    modeComm: mode === 'lines' ? lineComm : oidComm,
    modeCount: mode === 'lines' ? lineCount : byOid.size,
  };
}

async function fetchTransaction(token: string, start: string, end: string) {
  const all: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= 50) {
    const res = await axios.post(
      'https://api.partnermatic.com/api/transaction',
      {
        source: 'partnermatic',
        token,
        dataScope: 'user',
        beginDate: start,
        endDate: end,
        curPage: page,
        perPage: 2000,
      },
      { headers: { 'Content-Type': 'application/json' }, timeout: 120000 },
    );
    if (res.data?.code !== '0') throw new Error(res.data?.message ?? 'API error');
    const list = res.data.data?.list ?? [];
    const total = res.data.data?.total ?? list.length;
    totalPages = Math.ceil(total / 2000) || 1;
    all.push(...list);
    page += 1;
  }
  return all;
}

async function probeEndpoint(name: string, url: string, body: Record<string, unknown>) {
  try {
    const res = await axios.post(url, body, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    const ok = res.data?.code === '0' || res.data?.code === 0;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: code=${res.data?.code} keys=${res.data?.data ? Object.keys(res.data.data).join(',') : 'n/a'}`);
    if (ok && res.data.data) {
      const preview = JSON.stringify(res.data.data).slice(0, 200);
      console.log(`      preview: ${preview}...`);
    }
  } catch (e) {
    console.log(`  ✗ ${name}: ${e instanceof Error ? e.message : e}`);
  }
}

async function main() {
  loadEnv();
  const start = process.argv[2] ?? '2026-05-26';
  const end = process.argv[3] ?? '2026-06-01';
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
  const prisma = new PrismaClient();

  const account = await prisma.channelAccount.findFirst({
    where: { platform: { code: 'partnermatic' }, isActive: true },
    include: { platform: true },
  });
  if (!account) {
    console.log('无 PM 渠道账号');
    return;
  }

  const { apiToken } = decrypt(account.credentialsEnc, key);
  if (!apiToken) {
    console.log('无法解密 token');
    return;
  }

  console.log(`\n=== PM 对比 ${start} ~ ${end} (${account.affiliateAlias}) ===\n`);

  const raw = await fetchTransaction(apiToken, start, end);
  console.log(`API 返回 list 条数: ${raw.length} (total 字段见首屏)`);

  const inRange = raw.filter((o) => {
    const d = parsePmOrderDate(o.order_time as string | number | undefined);
    return d >= start && d <= end;
  });
  console.log(`按 order_time 落在区间内: ${inRange.length} 条`);

  const allSum = sumComm(raw, 'oid');
  const rangeSum = sumComm(inRange, 'oid');
  const lineSum = sumComm(raw, 'lines');

  console.log('\n佣金汇总 (API raw):');
  console.log(`  按 oid 合并: ${allSum.oidCount} 单, $${allSum.oidComm.toFixed(2)}`);
  console.log(`  按商品行:   ${lineSum.lineCount} 行, $${lineSum.lineComm.toFixed(2)}`);
  console.log(`  区间内 oid: ${rangeSum.oidCount} 单, $${rangeSum.oidComm.toFixed(2)}`);

  const dbOrders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: account.id,
      orderDate: {
        gte: new Date(`${start}T00:00:00.000Z`),
        lte: new Date(`${end}T23:59:59.999Z`),
      },
    },
  });
  const dbComm = dbOrders.reduce((s, o) => s + Number(o.commission), 0);
  console.log(`\n数据库: ${dbOrders.length} 行, $${dbComm.toFixed(2)}`);

  console.log('\n探测其他 PM 接口:');
  const base = { source: 'partnermatic', token: apiToken, beginDate: start, endDate: end };
  await probeEndpoint('transaction_v3', 'https://api.partnermatic.com/api/transaction_v3', {
    ...base,
    appId: 32,
    curPage: 1,
    perPage: 5,
  });
  const extraBodies = [
    base,
    { ...base, groupBy: 'merchant' },
    { ...base, group_by: 'merchant' },
    { ...base, reportType: 'performance' },
  ];
  const clickEndpoints = [
    'click',
    'clicks',
    'click_report',
    'click/list',
    'report/click',
    'report/clicks',
    'report/clicks_list',
    'user_click',
    'user_click2',
    'medium_click',
  ];
  for (const ep of [
    ...clickEndpoints,
    'performance',
    'performance_report',
    'performance_list',
    'performance_detail',
    'report/performance',
    'report/merchant',
    'report/brand',
    'get_performance',
    'merchant_performance',
    'merchant_report',
    'merchant_summary',
    'report_merchant',
    'report_performance',
    'cps_report',
    'brand_report',
    'summary',
    'stat_merchant',
  ]) {
    for (let i = 0; i < extraBodies.length; i++) {
      await probeEndpoint(
        `${ep}${i ? `#${i}` : ''}`,
        `https://api.partnermatic.com/api/${ep}`,
        extraBodies[i],
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
