import assert from 'assert';
import { googleAdsErrorMessage, parseChildAccounts, readCreatedResources } from './google-ads.client';

assert.deepStrictEqual(
  readCreatedResources({
    mutateOperationResponses: [
      { campaignBudgetResult: { resourceName: 'customers/1305125178/campaignBudgets/11' } },
      { campaignResult: { resourceName: 'customers/1305125178/campaigns/22' } },
      { campaignResult: { resourceName: 'customers/1305125178/campaigns/-2' } },
    ],
  }),
  {
    budget: 'customers/1305125178/campaignBudgets/11',
    campaign: 'customers/1305125178/campaigns/22',
  },
);

assert.strictEqual(
  googleAdsErrorMessage(
    { error: { message: 'Request contains an invalid argument.', details: [{ errors: [{ message: 'The campaign name is already used.' }] }] } },
    '失败',
  ),
  'The campaign name is already used.',
);

const children = parseChildAccounts([
  { customerClient: { clientCustomer: 'customers/111', status: 'ENABLED', manager: true, currencyCode: 'USD', timeZone: 'America/Los_Angeles' } },
  { customerClient: { clientCustomer: 'customers/2223334444', status: 'SUSPENDED', manager: false, currencyCode: 'USD', timeZone: 'Asia/Shanghai' } },
]);
assert.strictEqual(children.length, 1);
assert.strictEqual(children[0].customerId, '2223334444');
assert.strictEqual(children[0].googleStatus, 'SUSPENDED');

console.log('google-ads.client.test.ts: ok');
