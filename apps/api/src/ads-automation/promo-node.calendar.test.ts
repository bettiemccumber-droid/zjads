import assert from 'node:assert/strict';
import { listUpcomingPromoNodes, getPromoNodeDefinition } from './promo-node.calendar';

const nodes = listUpcomingPromoNodes(new Date('2026-11-20T08:00:00Z'));
assert.ok(nodes.length > 0);
assert.equal(nodes[0].key, 'thanksgiving');
assert.equal(nodes[0].daysUntil, 6);
assert.ok(nodes.some((row) => row.key === 'black_friday' && row.daysUntil === 7));
assert.ok(nodes.some((row) => row.key === 'cyber_monday' && row.daysUntil === 10));
assert.ok(getPromoNodeDefinition('black_friday'));
assert.equal(getPromoNodeDefinition('nope'), null);
console.log('promo-node.calendar.test.ts: ok');
