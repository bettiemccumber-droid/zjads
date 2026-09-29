import assert from 'node:assert/strict';
import {
  buildLhCommissionSlots,
  LH_CASHBACK2_FETCH_CHUNK_DAYS,
} from './linkhaitao-api.util';

function runTests() {
  assert.equal(LH_CASHBACK2_FETCH_CHUNK_DAYS, 7);

  assert.deepEqual(buildLhCommissionSlots('2026-09-01', '2026-09-28'), [
    { begin: '2026-09-01', end: '2026-09-07' },
    { begin: '2026-09-08', end: '2026-09-14' },
    { begin: '2026-09-15', end: '2026-09-21' },
    { begin: '2026-09-22', end: '2026-09-28' },
  ]);

  assert.deepEqual(buildLhCommissionSlots('2026-09-01', '2026-09-03'), [
    { begin: '2026-09-01', end: '2026-09-03' },
  ]);

  console.log('linkhaitao-api.util.test.ts: ok');
}

runTests();
