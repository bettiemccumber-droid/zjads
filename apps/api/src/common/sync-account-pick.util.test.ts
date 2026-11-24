import assert from 'node:assert/strict';
import { pickAccountsForAffiliateSync } from './sync-account-pick.util';

const accounts = [
  { id: 20, affiliateAlias: 'lh6', platform: { code: 'linkhaitao' }, name: 'storyun' },
  { id: 10, affiliateAlias: 'lh6', platform: { code: 'linkhaitao' }, name: 'beaconio' },
  { id: 11, affiliateAlias: 'lh5', platform: { code: 'linkhaitao' }, name: 'other-lh' },
  { id: 30, affiliateAlias: 'rw1', platform: { code: 'rewardoo' }, name: 'rw-a' },
  { id: 31, affiliateAlias: 'rw2', platform: { code: 'rewardoo' }, name: 'rw-b' },
];

const picked = pickAccountsForAffiliateSync(accounts);
assert.deepEqual(
  picked.map((a) => a.id),
  [10, 11, 30, 31],
  'LH 同 alias 只留 id 最小；RW 不同 alias 都保留',
);

const onlySecondary = pickAccountsForAffiliateSync([
  { id: 20, affiliateAlias: 'lh6', platform: { code: 'linkhaitao' } },
]);
assert.deepEqual(onlySecondary.map((a) => a.id), [20], '只勾选副账号时仍可单独采集');

console.log('sync-account-pick.util.test.ts: ok');
