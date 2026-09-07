import assert from 'node:assert/strict';
import { NormalizedStatus } from '@prisma/client';
import {
  aggregateAffiliateOrders,
  finalizeMerchantRows,
} from './commission-aggregate.util';
import {
  deploymentUnitKey,
  deploymentUnitKeyForAccount,
  filterAccountsByDeploymentUnit,
  rollupMerchantsByDeploymentUnit,
  summarizeMerchantsByDeploymentUnit,
} from './deployment-unit.util';

function order(
  partial: Partial<{
    channelAccountId: number;
    externalOrderId: string;
    merchantId: string;
    commission: number;
    displayName: string;
    alias: string;
    platformCode: string;
    platformName: string;
  }>,
) {
  return {
    channelAccountId: partial.channelAccountId ?? 1,
    externalOrderId: partial.externalOrderId ?? 'oid-1',
    merchantId: partial.merchantId ?? 'mid-1',
    merchantName: 'Merchant',
    commission: partial.commission ?? 10,
    normalizedStatus: NormalizedStatus.pending,
    channelAccount: {
      affiliateAlias: partial.alias ?? 'rw3',
      displayName: partial.displayName ?? 'huanghuang',
      platform: {
        code: partial.platformCode ?? 'rewardoo',
        name: partial.platformName ?? 'Rewardoo',
      },
    },
  };
}

function runTests() {
  assert.equal(
    deploymentUnitKey('rewardoo', 'HuangHuang', 'RW3'),
    'rewardoo|huanghuang|rw3',
  );

  const accounts = [
    {
      id: 10,
      displayName: 'huanghuang',
      affiliateAlias: 'rw3',
      platform: { code: 'rewardoo', name: 'Rewardoo' },
    },
    {
      id: 11,
      displayName: 'huanghuang',
      affiliateAlias: 'rw3',
      platform: { code: 'rewardoo', name: 'Rewardoo' },
    },
    {
      id: 20,
      displayName: 'thatymadelyn',
      affiliateAlias: 'lb3',
      platform: { code: 'linkbux', name: 'LinkBux' },
    },
    {
      id: 21,
      displayName: 'huanghuang',
      affiliateAlias: 'lb3',
      platform: { code: 'linkbux', name: 'LinkBux' },
    },
  ];

  assert.equal(deploymentUnitKeyForAccount(accounts[0]), deploymentUnitKeyForAccount(accounts[1]));
  assert.notEqual(deploymentUnitKeyForAccount(accounts[2]), deploymentUnitKeyForAccount(accounts[3]));

  const filtered = filterAccountsByDeploymentUnit(accounts, 10);
  assert.deepEqual(filtered.map((a) => a.id), [10, 11]);

  const perChannel = aggregateAffiliateOrders(
    [
      order({ channelAccountId: 10, externalOrderId: 'a', commission: 100, merchantId: 'm1' }),
      order({ channelAccountId: 11, externalOrderId: 'b', commission: 50, merchantId: 'm1' }),
      order({
        channelAccountId: 20,
        externalOrderId: 'c',
        commission: 4,
        merchantId: 'm2',
        alias: 'lb3',
        displayName: 'thatymadelyn',
        platformCode: 'linkbux',
        platformName: 'LinkBux',
      }),
      order({
        channelAccountId: 21,
        externalOrderId: 'd',
        commission: 8,
        merchantId: 'm3',
        alias: 'lb3',
        displayName: 'huanghuang',
        platformCode: 'linkbux',
        platformName: 'LinkBux',
      }),
    ],
    { groupByChannelAccount: true },
  );
  assert.equal(perChannel.length, 4);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const rolled = rollupMerchantsByDeploymentUnit(perChannel, accountById);
  assert.equal(rolled.length, 3);
  const rw = rolled.find((r) => r.platformCode === 'rewardoo' && r.merchantId === 'm1')!;
  assert.equal(rw.totalCommission, 150);
  assert.equal(rw.channelDisplayName, 'huanghuang');

  const summaries = summarizeMerchantsByDeploymentUnit(
    finalizeMerchantRows(rolled),
    accounts,
  );
  assert.equal(summaries.length, 3);
  const rwSummary = summaries.find((s) => s.platformCode === 'rewardoo' && s.affiliateAlias === 'rw3')!;
  assert.equal(rwSummary.channelCount, 2);
  assert.deepEqual(rwSummary.channelAccountIds, [10, 11]);
  assert.equal(rwSummary.totalCommission, 150);

  const lbSummaries = summaries.filter((s) => s.platformCode === 'linkbux');
  assert.equal(lbSummaries.length, 2);
  assert.equal(lbSummaries.reduce((sum, s) => sum + s.totalCommission, 0), 12);

  console.log('deployment-unit.util.test.ts: all passed');
}

runTests();
