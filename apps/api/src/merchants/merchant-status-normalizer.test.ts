import assert from 'node:assert/strict';
import {
  buildActionLabel,
  isMerchantActionable,
  normalizeMerchantAvailability,
  normalizeRelationshipStatus,
  parseMerchantQueryText,
} from './merchant-status-normalizer';

function runTests() {
  assert.equal(normalizeRelationshipStatus('Joined'), 'joined');
  assert.equal(normalizeRelationshipStatus('Pending'), 'pending');
  assert.equal(normalizeRelationshipStatus('No Relationship'), 'not_joined');
  assert.equal(normalizeRelationshipStatus('Processing'), 'pending');
  assert.equal(normalizeMerchantAvailability('Online'), 'online');
  assert.equal(normalizeMerchantAvailability('Offline'), 'offline');
  assert.equal(buildActionLabel('joined', 'online', false), '可投');
  assert.equal(isMerchantActionable('joined', 'online'), true);
  assert.equal(buildActionLabel('joined', 'offline', false), '商家已下架');
  assert.deepEqual(parseMerchantQueryText('18649156\n144471'), [
    { merchantId: '18649156' },
    { merchantId: '144471' },
  ]);
  console.log('merchant-status-normalizer.test.ts OK');
}

runTests();
