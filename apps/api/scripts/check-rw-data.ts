/**
 * RW 订单数 / 联盟点击校对（只读，不写入数据库）
 *
 * 对比：联盟 Performance API 实时复拉 vs DB 日汇总 vs 明细订单表
 * 佣金仅作参考展示（当前口径已对齐，本脚本不修改任何采集/报表逻辑）
 *
 * 用法:
 *   npx ts-node --transpile-only scripts/check-rw-data.ts 2026-07-03 2026-07-09 rw3
 */
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { dedupeAffiliateOrderKey } from '../src/common/order-dedupe.util';
import { isOrderDateInReportRange } from '../src/common/affiliate-order-date.util';
import {
  buildRwDailyMetricsFromDetailRows,
  fetchRewardooCommissions,
  summarizeRwCommissionApi,
} from '../src/collectors/rewardoo.collector';
import type { RwCommissionRow } from '../src/collectors/rewardoo.collector';
import {
  fetchRewardooClicksQuick,
  fetchRewardooPerformanceDailyAggs,
  isRwClickPseudoMerchant,
} from '../src/collectors/rewardoo-clicks';

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

interface DayTotals {
  orders: number;
  clicks: number;
  commission: number;
}

/** 按自然日汇总商家日指标 */
function sumByDay(
  rows: Array<{ clickDate: string; performanceOrders?: number; clicks?: number; performanceCommission?: number }>,
): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const r of rows) {
    const day = r.clickDate.slice(0, 10);
    const prev = map.get(day) ?? { orders: 0, clicks: 0, commission: 0 };
    prev.orders += r.performanceOrders ?? 0;
    prev.clicks += r.clicks ?? 0;
    prev.commission += r.performanceCommission ?? 0;
    map.set(day, prev);
  }
  return map;
}

function sumMap(map: Map<string, DayTotals>): DayTotals {
  let orders = 0;
  let clicks = 0;
  let commission = 0;
  for (const v of map.values()) {
    orders += v.orders;
    clicks += v.clicks;
    commission += v.commission;
  }
  return {
    orders,
    clicks,
    commission: Math.round(commission * 100) / 100,
  };
}

function fmtDelta(a: number, b: number): string {
  const d = b - a;
  if (d === 0) return '✓';
  const sign = d > 0 ? '+' : '';
  return `${sign}${d}`;
}

async function main() {
  const start = process.argv[2] ?? '2026-07-03';
  const end = process.argv[3] ?? '2026-07-09';
  const alias = process.argv[4] ?? 'rw3';

  const account = await prisma.channelAccount.findFirst({
    where: {
      platform: { code: 'rewardoo' },
      OR: [{ affiliateAlias: alias }, { displayName: { contains: alias } }],
    },
    include: { platform: true },
  });

  if (!account) {
    console.log(`未找到 RW 账号 (${alias})`);
    process.exit(1);
  }

  console.log(`=== RW 校对（只读）===`);
  console.log(`账号: ${account.displayName} (${account.affiliateAlias}) id=${account.id}`);
  console.log(`区间: ${start} ~ ${end}`);
  console.log('说明: 本脚本不写入 DB，不影响佣金/广告费采集逻辑\n');

  const cred = await prisma.channelAccount.findUnique({
    where: { id: account.id },
    select: { credentialsEnc: true },
  });

  let apiToken: string | undefined;
  if (cred?.credentialsEnc && process.env.CREDENTIALS_ENCRYPTION_KEY) {
    try {
      apiToken = decryptCredentials(cred.credentialsEnc).apiToken;
    } catch (e) {
      console.log('（凭证解密失败，跳过 API 复拉）', e instanceof Error ? e.message : e);
    }
  }

  // --- DB: affiliate_merchant_click_daily（看板 RW 订单/佣金/点击口径）---
  const dbClickRows = await prisma.affiliateMerchantClickDaily.findMany({
    where: {
      channelAccountId: account.id,
      clickDate: { gte: new Date(start), lte: new Date(end) },
    },
    select: {
      merchantId: true,
      merchantName: true,
      clickDate: true,
      clicks: true,
      performanceOrders: true,
      performanceCommission: true,
      source: true,
    },
  });

  const dbPerfRows = dbClickRows
    .filter((r) => !isRwClickPseudoMerchant(r.merchantId))
    .map((r) => ({
      merchantId: r.merchantId,
      merchantName: r.merchantName ?? '',
      clickDate: r.clickDate.toISOString().slice(0, 10),
      performanceOrders: r.performanceOrders,
      clicks: r.clicks,
      performanceCommission: Number(r.performanceCommission),
    }));

  const dbDay = sumByDay(dbPerfRows);
  const dbTotal = sumMap(dbDay);

  console.log('=== DB 日汇总表（看板 RW 口径）===');
  console.log(
    `Performance 订单 ${dbTotal.orders} · 联盟点击 ${dbTotal.clicks} · 佣金 $${dbTotal.commission.toFixed(2)}`,
  );
  console.log(`行数: ${dbPerfRows.length}（含 manual 校准行: ${dbClickRows.filter((r) => r.source === 'manual').length}）`);

  // --- DB: affiliate_order 明细去重 ---
  const dbOrders = await prisma.affiliateOrder.findMany({
    where: {
      channelAccountId: account.id,
      orderDate: {
        gte: new Date(`${start}T00:00:00.000Z`),
        lte: new Date(`${end}T23:59:59.999Z`),
      },
    },
    select: {
      externalOrderId: true,
      commission: true,
      orderDate: true,
      merchantId: true,
      merchantName: true,
    },
  });

  const dedupeKeys = new Set<string>();
  let dbDetailComm = 0;
  for (const o of dbOrders) {
    const key = `${account.id}|${dedupeAffiliateOrderKey(o.externalOrderId)}`;
    if (dedupeKeys.has(key)) continue;
    dedupeKeys.add(key);
    dbDetailComm += Number(o.commission);
  }
  dbDetailComm = Math.round(dbDetailComm * 100) / 100;

  console.log('\n=== DB 订单明细（transaction_details 入库口径）===');
  console.log(`去重订单 ${dedupeKeys.size} · 佣金 $${dbDetailComm.toFixed(2)} · 原始行 ${dbOrders.length}`);

  // --- 明细推导 Performance 订单数 ---
  let detailDerivedOrders = 0;
  let detailDerivedComm = 0;
  if (apiToken) {
    const bundle = await fetchRewardooCommissions(apiToken, start, end, (m) =>
      console.log(`  ${m}`),
    );
    const detailRows = bundle.rows as RwCommissionRow[];
    const range = { startDate: start, endDate: end };
    const apiSummary = summarizeRwCommissionApi(detailRows, bundle.source, range);
    const detailMetrics = buildRwDailyMetricsFromDetailRows(detailRows, start, end);
    detailDerivedOrders = detailMetrics.reduce((s, m) => s + m.performanceOrders, 0);
    detailDerivedComm = detailMetrics.reduce((s, m) => s + m.performanceCommission, 0);

    console.log('\n=== transaction_details API 复拉 ===');
    console.log(
      `原始行 ${apiSummary.apiListRows} · 合并入库 ${apiSummary.orderCount} 单 · 佣金 $${apiSummary.totalCommission.toFixed(2)}`,
    );
    console.log(
      `明细推导 Performance 订单 ${detailDerivedOrders} · 佣金 $${detailDerivedComm.toFixed(2)}（sign_id 计单）`,
    );

    console.log('\n=== 联盟 Performance API 复拉（后台看板口径）===');
    const perfAggs = await fetchRewardooPerformanceDailyAggs(
      apiToken,
      start,
      end,
      undefined,
      (m) => console.log(`  ${m}`),
      { includeClicks: true, skipOrderFetch: false },
    );
    const perfFiltered = perfAggs.filter((r) => !isRwClickPseudoMerchant(r.merchantId));
    const apiDay = sumByDay(
      perfFiltered.map((r) => ({
        clickDate: r.clickDate,
        performanceOrders: r.performanceOrders,
        clicks: r.clicks,
        performanceCommission: r.performanceCommission,
      })),
    );
    const apiTotal = sumMap(apiDay);

    const quickClicks = await fetchRewardooClicksQuick(apiToken, start, end);
    const quickClickTotal = quickClicks.reduce((s, r) => s + r.clicks, 0);

    console.log(
      `Performance 逐日汇总 → 订单 ${apiTotal.orders} · 点击 ${apiTotal.clicks} · 佣金 $${apiTotal.commission.toFixed(2)}`,
    );
    console.log(`fetchRewardooClicksQuick 点击合计 ${quickClickTotal}（采集 supplement 同源路径）`);

    console.log('\n=== 区间汇总对比 ===');
    console.log(
      `${'指标'.padEnd(12)} ${'联盟 API'.padStart(10)} ${'DB 看板'.padStart(10)} ${'差额(DB-API)'.padStart(12)}`,
    );
    console.log(
      `${'订单数'.padEnd(12)} ${String(apiTotal.orders).padStart(10)} ${String(dbTotal.orders).padStart(10)} ${fmtDelta(apiTotal.orders, dbTotal.orders).padStart(12)}`,
    );
    console.log(
      `${'联盟点击'.padEnd(12)} ${String(apiTotal.clicks).padStart(10)} ${String(dbTotal.clicks).padStart(10)} ${fmtDelta(apiTotal.clicks, dbTotal.clicks).padStart(12)}`,
    );
    console.log(
      `${'佣金(参考)'.padEnd(12)} ${('$' + apiTotal.commission.toFixed(2)).padStart(10)} ${('$' + dbTotal.commission.toFixed(2)).padStart(10)} ${fmtDelta(apiTotal.commission, dbTotal.commission).padStart(12)}`,
    );
    console.log(
      `${'明细去重单'.padEnd(12)} ${'—'.padStart(10)} ${String(dedupeKeys.size).padStart(10)} ${'—'.padStart(12)}`,
    );
    console.log(
      `${'明细→Perf单'.padEnd(12)} ${String(detailDerivedOrders).padStart(10)} ${String(dbTotal.orders).padStart(10)} ${fmtDelta(detailDerivedOrders, dbTotal.orders).padStart(12)}`,
    );

    if (apiTotal.clicks > 0 && dbTotal.clicks === 0) {
      console.log(
        '\n⚠️  联盟后台有点击，DB 为 0：采集 supplement 未解析到 clicks 字段（佣金/订单 Performance 不受影响）',
      );
      console.log('    建议: 用 rw-click-probe.ts 探测 API 返回字段，再单独修点击解析（不动 commission 链路）');
    }
    if (apiTotal.orders !== dbTotal.orders) {
      console.log(
        `\n⚠️  订单数差额 ${dbTotal.orders - apiTotal.orders}：看板用 performanceOrders，明细合并口径可能不同`,
      );
    }
    if (Math.abs(dbTotal.commission - apiTotal.commission) > 0.02) {
      console.log(
        `\n⚠️  佣金差额 $${(dbTotal.commission - apiTotal.commission).toFixed(2)}（若较大请检查 Transaction Date 边界）`,
      );
    } else {
      console.log('\n✓  佣金 DB 与 Performance API 基本一致（当前链路正常）');
    }

    console.log('\n=== 按天对比（订单 / 点击）===');
    const allDays = new Set([...apiDay.keys(), ...dbDay.keys()]);
    console.log(
      `${'日期'.padEnd(12)} ${'API单'.padStart(6)} ${'DB单'.padStart(6)} ${'Δ单'.padStart(5)} ${'API点'.padStart(6)} ${'DB点'.padStart(6)} ${'Δ点'.padStart(5)}`,
    );
    for (const day of [...allDays].sort()) {
      const a = apiDay.get(day) ?? { orders: 0, clicks: 0, commission: 0 };
      const d = dbDay.get(day) ?? { orders: 0, clicks: 0, commission: 0 };
      console.log(
        `${day.padEnd(12)} ${String(a.orders).padStart(6)} ${String(d.orders).padStart(6)} ${fmtDelta(a.orders, d.orders).padStart(5)} ${String(a.clicks).padStart(6)} ${String(d.clicks).padStart(6)} ${fmtDelta(a.clicks, d.clicks).padStart(5)}`,
      );
    }

    const merchantGaps = new Map<
      string,
      { name: string; apiOrders: number; dbOrders: number; apiClicks: number; dbClicks: number }
    >();
    for (const r of perfFiltered) {
      const cur = merchantGaps.get(r.merchantId) ?? {
        name: r.merchantName,
        apiOrders: 0,
        dbOrders: 0,
        apiClicks: 0,
        dbClicks: 0,
      };
      cur.apiOrders += r.performanceOrders;
      cur.apiClicks += r.clicks;
      if (r.merchantName) cur.name = r.merchantName;
      merchantGaps.set(r.merchantId, cur);
    }
    for (const r of dbPerfRows) {
      const cur = merchantGaps.get(r.merchantId) ?? {
        name: r.merchantName,
        apiOrders: 0,
        dbOrders: 0,
        apiClicks: 0,
        dbClicks: 0,
      };
      cur.dbOrders += r.performanceOrders;
      cur.dbClicks += r.clicks;
      if (r.merchantName) cur.name = r.merchantName;
      merchantGaps.set(r.merchantId, cur);
    }

    const topGaps = [...merchantGaps.entries()]
      .map(([mid, v]) => ({
        mid,
        ...v,
        orderGap: v.dbOrders - v.apiOrders,
        clickGap: v.dbClicks - v.apiClicks,
      }))
      .filter((m) => m.orderGap !== 0 || m.clickGap !== 0)
      .sort(
        (a, b) =>
          Math.abs(b.orderGap) + Math.abs(b.clickGap) -
          (Math.abs(a.orderGap) + Math.abs(a.clickGap)),
      );

    if (topGaps.length > 0) {
      console.log('\n=== 商家 Top 差异（|Δ单|+|Δ点| 排序）===');
      for (const m of topGaps.slice(0, 15)) {
        console.log(
          `  mid=${m.mid} ${m.name.slice(0, 24)} | API ${m.apiOrders}单/${m.apiClicks}点 · DB ${m.dbOrders}单/${m.dbClicks}点 · Δ单${m.orderGap >= 0 ? '+' : ''}${m.orderGap} Δ点${m.clickGap >= 0 ? '+' : ''}${m.clickGap}`,
        );
      }
    }
  } else {
    console.log('\n（无 API Token，仅展示 DB 汇总）');
    console.log(`DB Performance 订单 ${dbTotal.orders} · 点击 ${dbTotal.clicks} · 佣金 $${dbTotal.commission.toFixed(2)}`);
    console.log(`DB 明细去重 ${dedupeKeys.size} 单 · 佣金 $${dbDetailComm.toFixed(2)}`);
    if (dbTotal.orders !== dedupeKeys.size) {
      console.log(
        `\n⚠️  看板 Performance 订单 ${dbTotal.orders} vs 明细去重 ${dedupeKeys.size}（RW 正常情况：Performance ≠ 明细行数）`,
      );
    }
  }

  const inRangeDetail = dbOrders.filter((o) =>
    isOrderDateInReportRange(o.orderDate, start, end),
  );
  if (inRangeDetail.length !== dbOrders.length) {
    console.log(
      `\n（orderDate 区间外仍存 ${dbOrders.length - inRangeDetail.length} 行，可能影响明细去重 vs 采集任务计数）`,
    );
  }

  const latestJob = await prisma.syncJobItem.findFirst({
    where: { channelAccountId: account.id },
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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
