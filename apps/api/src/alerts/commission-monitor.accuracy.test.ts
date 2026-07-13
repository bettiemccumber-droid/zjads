/**
 * 佣金监控准确性回归（运行: npx ts-node src/alerts/commission-monitor.accuracy.test.ts）
 */
import assert from 'node:assert/strict';
import { NormalizedStatus } from '@prisma/client';
import {
  aggregateAffiliateOrders,
  aggregateAffiliateOrdersForMonitor,
} from '../common/commission-aggregate.util';
import { evaluateCommissionRisk, defaultMonitorRule } from './commission-monitor.util';
import { normalizeLinkHaitaoOrders } from '../collectors/linkhaitao.collector';
import { normalizeLinkBuxOrders } from '../collectors/linkbux.collector';
import { normalizePartnerMaticOrders } from '../collectors/partnermatic.collector';
import { normalizeRewardooOrders } from '../collectors/rewardoo.collector';

const rule = defaultMonitorRule();

function order(
  partial: Partial<{
    channelAccountId: number;
    externalOrderId: string;
    merchantId: string;
    merchantName: string;
    commission: number;
    normalizedStatus: NormalizedStatus;
    rawPayload: unknown;
    alias: string;
    displayName: string;
    platformCode: string;
    platformName: string;
  }>,
) {
  const platformCode = partial.platformCode ?? 'linkbux';
  return {
    channelAccountId: partial.channelAccountId ?? 1,
    externalOrderId: partial.externalOrderId ?? 'oid-1',
    merchantId: partial.merchantId ?? 'mid-1',
    merchantName: partial.merchantName ?? 'Test Merchant',
    commission: partial.commission ?? 10,
    normalizedStatus: partial.normalizedStatus ?? NormalizedStatus.rejected,
    rawPayload: partial.rawPayload,
    channelAccount: {
      affiliateAlias: partial.alias ?? 'lb2',
      displayName: partial.displayName,
      platform: { code: platformCode, name: partial.platformName ?? 'LinkBux' },
    },
  };
}

// 高拒付率场景（佣金加权）
{
  const rows = aggregateAffiliateOrdersForMonitor([
    order({ externalOrderId: 'a', commission: 91, normalizedStatus: NormalizedStatus.rejected }),
    order({ externalOrderId: 'b', commission: 9, normalizedStatus: NormalizedStatus.approved }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rejectionRate, 91);
  const ev = evaluateCommissionRisk(rows[0], rule);
  assert.equal(ev.hit, true);
  assert.ok(ev.reasons.some((r) => r.includes('91.0%')));
}

// 多渠道合并后应与结算分项之和一致（订单按平台去重）
{
  const orders = [
    order({ channelAccountId: 1, alias: 'lb2', externalOrderId: 'x', commission: 50 }),
    order({ channelAccountId: 2, alias: 'lb3', externalOrderId: 'x', commission: 50 }),
  ];
  const perChannel = aggregateAffiliateOrders(orders);
  assert.equal(perChannel.length, 2);
  const merged = aggregateAffiliateOrdersForMonitor(orders);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].orderCount, 1);
  assert.equal(merged[0].rejectedCommission, 50);
}

// 结算：同平台两账号（同 affiliateAlias）分别统计
{
  const orders = [
    order({
      channelAccountId: 10,
      alias: 'lb3',
      displayName: 'LinkBux · 账号A',
      merchantId: '384942',
      externalOrderId: 'e1',
      commission: 100,
    }),
    order({
      channelAccountId: 11,
      alias: 'lb3',
      displayName: 'LinkBux · 账号B',
      merchantId: '384942',
      externalOrderId: 'e2',
      commission: 50,
    }),
  ];
  const settlement = aggregateAffiliateOrders(orders, { groupByChannelAccount: true });
  assert.equal(settlement.length, 2);
  assert.equal(
    settlement.reduce((s, r) => s + r.totalCommission, 0),
    150,
  );
  const a = settlement.find((r) => r.channelAccountId === 10)!;
  const b = settlement.find((r) => r.channelAccountId === 11)!;
  assert.equal(a.totalCommission, 100);
  assert.equal(b.totalCommission, 50);
}

// 金额阈值 + 浮点
{
  const row = {
    merchantId: '1',
    merchantName: 'm',
    platformCode: 'linkbux',
    platformName: 'LB',
    affiliateAlias: 'lb2',
    orderCount: 1,
    rejectedOrderCount: 1,
    totalCommission: 100.004,
    confirmedCommission: 0,
    pendingCommission: 0,
    rejectedCommission: 100.004,
    rejectionRate: 100,
  };
  const ev = evaluateCommissionRisk(row, { ...rule, rejectedAmountThreshold: 100 });
  assert.equal(ev.hit, true);
}

// 未达最低拒付单数
{
  const row = {
    merchantId: '1',
    merchantName: 'm',
    platformCode: 'linkbux',
    platformName: 'LB',
    affiliateAlias: 'lb2',
    orderCount: 2,
    rejectedOrderCount: 0,
    totalCommission: 200,
    confirmedCommission: 200,
    pendingCommission: 0,
    rejectedCommission: 0,
    rejectionRate: 0,
  };
  assert.equal(evaluateCommissionRisk(row, rule).hit, false);
}

// LH 同单混状态：失效佣金只计 Rejected 子行（与联盟后台拒付筛选一致）
{
  const lhMappings = [
    { rawStatus: 'Rejected', normalizedStatus: NormalizedStatus.rejected },
    { rawStatus: 'Pending', normalizedStatus: NormalizedStatus.pending },
    { rawStatus: 'Approved', normalizedStatus: NormalizedStatus.approved },
  ];
  const lhRows = normalizeLinkHaitaoOrders(
    [
      { order_id: '19055435', m_id: '157206', cashback: 0.87, sale_amount: 63.1, status: 'expired' },
      { order_id: '19055435', m_id: '157206', cashback: 1.71, sale_amount: 122.35, status: 'untreated' },
      { order_id: '19051546', m_id: '157206', cashback: 1.59, sale_amount: 114.59, status: 'expired' },
      { order_id: '19051546', m_id: '157206', cashback: 0.99, sale_amount: 71.07, status: 'untreated' },
      { order_id: '19039920', m_id: '157206', cashback: 0.9, sale_amount: 64.35, status: 'untreated' },
    ],
    lhMappings as never,
  );
  const monitorRows = aggregateAffiliateOrdersForMonitor(
    lhRows.map((o) => ({
      channelAccountId: 1,
      externalOrderId: o.externalOrderId,
      merchantId: o.merchantId,
      merchantName: o.merchantName,
      commission: o.commission,
      normalizedStatus: o.normalizedStatus,
      rawPayload: o.rawPayload,
      channelAccount: {
        affiliateAlias: 'lh2',
        platform: { code: 'linkhaitao', name: 'LinkHaitao' },
      },
    })),
  );
  assert.equal(monitorRows.length, 1);
  assert.equal(monitorRows[0].rejectedCommission, 2.46);
  assert.equal(monitorRows[0].pendingCommission, 3.6);
  assert.equal(monitorRows[0].totalCommission, 6.06);
  assert.equal(monitorRows[0].rejectedOrderCount, 2);
}

// 监控应与结算表同口径：分渠道聚合，不应跨 pm2/pm3 误合并历史拒付
{
  const orders = [
    order({
      channelAccountId: 1,
      alias: 'pm2',
      platformCode: 'partnermatic',
      platformName: 'PartnerMatic',
      merchantId: '113208',
      merchantName: 'Yoin (BE)',
      externalOrderId: 'new-1',
      commission: 18.23,
      normalizedStatus: NormalizedStatus.approved,
    }),
    order({
      channelAccountId: 2,
      alias: 'pm3',
      platformCode: 'partnermatic',
      platformName: 'PartnerMatic',
      merchantId: '113208',
      merchantName: 'Yoin (BE)',
      externalOrderId: 'old-rej-1',
      commission: 50,
      normalizedStatus: NormalizedStatus.rejected,
    }),
  ];
  const settlement = aggregateAffiliateOrders(orders);
  assert.equal(settlement.length, 2);
  const pm2 = settlement.find((r) => r.affiliateAlias === 'pm2')!;
  assert.equal(pm2.rejectedCommission, 0);
  assert.equal(pm2.confirmedCommission, 18.23);
  const pm3 = settlement.find((r) => r.affiliateAlias === 'pm3')!;
  assert.equal(pm3.rejectedCommission, 50);
}

// LB 同单混状态：失效佣金只计 Rejected 子行（APL 类多计修复）
{
  const lbMappings = [
    { rawStatus: 'Rejected', normalizedStatus: NormalizedStatus.rejected },
    { rawStatus: 'Pending', normalizedStatus: NormalizedStatus.pending },
    { rawStatus: 'Approved', normalizedStatus: NormalizedStatus.approved },
  ];
  const lbRows = normalizeLinkBuxOrders(
    [
      {
        order_id: 'apl-1',
        mid: '247276',
        order_time: 1783036800,
        sale_comm: 0,
        sale_amount: 0,
        status: 'Rejected',
      },
      {
        order_id: 'apl-1',
        mid: '247276',
        order_time: 1783036800,
        sale_comm: 17.64,
        sale_amount: 100,
        status: 'Pending',
      },
      {
        order_id: 'apl-2',
        mid: '247276',
        order_time: 1783036800,
        sale_comm: 17.64,
        sale_amount: 100,
        status: 'Rejected',
      },
    ],
    lbMappings as never,
  );
  const agg = aggregateAffiliateOrders(
    lbRows.map((o) => ({
      channelAccountId: 1,
      externalOrderId: o.externalOrderId,
      merchantId: o.merchantId,
      merchantName: o.merchantName,
      commission: o.commission,
      normalizedStatus: o.normalizedStatus,
      rawPayload: o.rawPayload,
      channelAccount: {
        affiliateAlias: 'lb3',
        platform: { code: 'linkbux', name: 'LinkBux' },
      },
    })),
  );
  assert.equal(agg.length, 1);
  assert.equal(agg[0].rejectedCommission, 17.64);
  assert.equal(agg[0].pendingCommission, 17.64);
  assert.equal(agg[0].totalCommission, 35.28);
}

// RW expired 状态映射 + 混状态 breakdown
{
  const rwMappings = [
    { rawStatus: 'Rejected', normalizedStatus: NormalizedStatus.rejected },
    { rawStatus: 'Pending', normalizedStatus: NormalizedStatus.pending },
    { rawStatus: 'Approved', normalizedStatus: NormalizedStatus.approved },
  ];
  const rwRows = normalizeRewardooOrders(
    [
      {
        order_id: 'rw-1',
        mid: '122341',
        transaction_date: '2026-06-01',
        cashback: 1.76,
        sale_amount: 21.01,
        status: 'expired',
      },
      {
        order_id: 'rw-2',
        mid: '122341',
        transaction_date: '2026-06-02',
        cashback: 0,
        sale_amount: 0,
        status: 'expired',
      },
      {
        order_id: 'rw-2',
        mid: '122341',
        transaction_date: '2026-06-02',
        cashback: 0.6,
        sale_amount: 10,
        status: 'new',
      },
    ],
    rwMappings as never,
  );
  assert.equal(rwRows.length, 2);
  const expired = rwRows.find((o) => o.externalOrderId === 'rw-1')!;
  assert.equal(expired.normalizedStatus, NormalizedStatus.rejected);
  const mixed = rwRows.find((o) => o.externalOrderId === 'rw-2')!;
  const payload = mixed.rawPayload as { _commissionBreakdown?: { rejected: number; pending: number } };
  assert.equal(payload._commissionBreakdown?.rejected, 0);
  assert.equal(payload._commissionBreakdown?.pending, 0.6);
}

// PM 同 oid 多行混状态
{
  const pmMappings = [
    { rawStatus: 'Rejected', normalizedStatus: NormalizedStatus.rejected },
    { rawStatus: 'Pending', normalizedStatus: NormalizedStatus.pending },
    { rawStatus: 'Approved', normalizedStatus: NormalizedStatus.approved },
  ];
  const pmRows = normalizePartnerMaticOrders(
    [
      {
        oid: 'pm-oid-1',
        brand_id: '65065',
        merchant_name: 'Grande',
        order_time: '1749289879',
        sale_comm: 4.82,
        status: 'Rejected',
      },
      {
        oid: 'pm-oid-1',
        brand_id: '65065',
        merchant_name: 'Grande',
        order_time: '1749289879',
        sale_comm: 10,
        status: 'Pending',
      },
    ],
    pmMappings as never,
  );
  assert.equal(pmRows.length, 1);
  const payload = pmRows[0].rawPayload as { _commissionBreakdown?: { rejected: number; pending: number } };
  assert.equal(payload._commissionBreakdown?.rejected, 4.82);
  assert.equal(payload._commissionBreakdown?.pending, 10);
}

// RW Transaction Date 优先：与后台 Channel 报表筛选一致
{
  const rwMappings = [{ rawStatus: 'Pending', normalizedStatus: NormalizedStatus.pending }];
  const inRange = normalizeRewardooOrders(
    [
      {
        order_id: 'rw-tz-in',
        mid: '1',
        transaction_date: '2026-07-03',
        order_time: 1783036800,
        cashback: 10,
        sale_amount: 100,
        status: 'new',
      },
      {
        order_id: 'rw-tz-out',
        mid: '1',
        transaction_date: '2026-07-02',
        order_time: 1783036800,
        cashback: 5,
        sale_amount: 50,
        status: 'new',
      },
    ],
    rwMappings as never,
    { startDate: '2026-07-03', endDate: '2026-07-09' },
  );
  assert.equal(inRange.length, 1);
  assert.equal(inRange[0].externalOrderId, 'rw-tz-in');
  assert.equal(inRange[0].orderDate.toISOString().slice(0, 10), '2026-07-03');
}

console.log('commission-monitor.accuracy: all passed');
