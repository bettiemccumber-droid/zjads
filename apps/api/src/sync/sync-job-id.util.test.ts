import assert from 'node:assert/strict';
import { SYNC_JOB_ID_CEILING } from './sync-job-id.util';

function runTests() {
  assert.equal(SYNC_JOB_ID_CEILING, 1000);
  console.log('sync-job-id.util.test.ts: all passed');
}

runTests();
