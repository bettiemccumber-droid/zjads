import assert from 'node:assert/strict';
import { explainModelGoError } from './modelgo.client';

assert.equal(
  explainModelGoError(429, { error: { message: 'Rate limit exceeded' } }),
  'AI 请求过于频繁，请稍后重试',
);

assert.equal(
  explainModelGoError(503, { error: { message: 'quota exceeded for model' } }),
  'AI 请求额度受限，请稍后重试',
);

assert.equal(
  explainModelGoError(402, { error: { message: 'Payment required' } }),
  'AI 余额不足，请先在控制台充值',
);

assert.equal(
  explainModelGoError(400, { error: { message: 'insufficient balance, please top up' } }),
  'AI 余额不足，请先在控制台充值',
);

assert.equal(
  explainModelGoError(400, { error: { message: 'insufficient capacity in region' } }),
  'AI 调用失败：insufficient capacity in region',
  '不应把任意 insufficient 当成余额不足',
);

assert.equal(
  explainModelGoError(400, { error: { message: 'invalid credit card field' } }),
  'AI 调用失败：invalid credit card field',
  '不应把任意 credit 当成余额不足',
);

console.log('modelgo.client.test.ts: ok');
