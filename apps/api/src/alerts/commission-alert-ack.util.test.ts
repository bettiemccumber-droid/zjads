import { shouldReopenAckedAlert } from './commission-alert-ack.util';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const snapshot = {
  ackedRejectedCommission: 11.81,
  ackedRejectedOrderCount: 10,
  ackedRejectionRate: 100,
};

assert(
  !shouldReopenAckedAlert(snapshot, {
    rejectedCommission: 11.81,
    rejectedOrderCount: 10,
    rejectionRate: 100,
  }),
  'equal metrics should not reopen',
);

assert(
  !shouldReopenAckedAlert(snapshot, {
    rejectedCommission: 10,
    rejectedOrderCount: 8,
    rejectionRate: 80,
  }),
  'decreased metrics should not reopen',
);

assert(
  shouldReopenAckedAlert(snapshot, {
    rejectedCommission: 12,
    rejectedOrderCount: 10,
    rejectionRate: 100,
  }),
  'higher rejected commission should reopen',
);

assert(
  shouldReopenAckedAlert(snapshot, {
    rejectedCommission: 11.81,
    rejectedOrderCount: 11,
    rejectionRate: 100,
  }),
  'higher rejected order count should reopen',
);

assert(
  shouldReopenAckedAlert(snapshot, {
    rejectedCommission: 11.81,
    rejectedOrderCount: 10,
    rejectionRate: 100.1,
  }),
  'higher rejection rate should reopen',
);

assert(
  !shouldReopenAckedAlert({}, { rejectedCommission: 999, rejectedOrderCount: 99, rejectionRate: 99 }),
  'legacy ack without snapshot should not reopen',
);

console.log('commission-alert-ack.util.test.ts OK');
