import assert from 'node:assert/strict';
import {
  buildActionLabel,
  isMerchantActionable,
  mapCatalogOffer,
  normalizeMerchantAvailability,
  normalizeRelationshipStatus,
  parseMerchantQueryText,
} from './merchant-status-normalizer';

function runTests() {
  assert.equal(normalizeRelationshipStatus('Joined'), 'joined');
  assert.equal(normalizeRelationshipStatus('Pending'), 'pending');
  assert.equal(normalizeRelationshipStatus('No Relationship'), 'not_joined');
  assert.equal(normalizeRelationshipStatus('Processing'), 'pending');
  assert.equal(normalizeRelationshipStatus('4'), 'joined');
  assert.equal(normalizeRelationshipStatus('2'), 'pending');
  assert.equal(normalizeRelationshipStatus('1'), 'not_joined');
  assert.equal(normalizeMerchantAvailability('Online'), 'online');
  assert.equal(normalizeMerchantAvailability('Offline'), 'offline');
  assert.equal(normalizeMerchantAvailability('1'), 'online');
  assert.equal(normalizeMerchantAvailability('0'), 'offline');
  assert.equal(buildActionLabel('joined', 'online', false), '可投');
  assert.equal(buildActionLabel('not_found', 'unknown', false), '无商家');
  assert.equal(isMerchantActionable('joined', 'online'), true);
  assert.equal(buildActionLabel('joined', 'offline', false), '商家已下架');
  assert.deepEqual(parseMerchantQueryText('18649156\n144471'), [
    { merchantId: '18649156' },
    { merchantId: '144471' },
  ]);
  const offer = mapCatalogOffer({
    brand_id: 1896,
    merchant_name: 'Julep',
    site_url: 'https://julep.com',
    comm_rate: 'Rev. Share:65.00%',
    categories: 'Health & Beauty',
    country: 'US',
    support_region: 'US,PR',
    relationship: 'Joined',
    brand_status: 'Online',
  });
  assert.equal(offer.merchantId, '1896');
  assert.equal(offer.siteUrl, 'https://julep.com');
  assert.equal(offer.commRate, 'Rev. Share:65.00%');
  assert.equal(offer.countryCode, 'US');
  assert.equal(offer.relationshipStatus, 'joined');
  console.log('merchant-status-normalizer.test.ts OK');
}

runTests();
