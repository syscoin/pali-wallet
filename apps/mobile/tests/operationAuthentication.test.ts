import assert from 'node:assert/strict';
import test from 'node:test';
import { operationAuthenticationCancellation, isOperationAuthenticationCancellation } from '../src/core/operationAuthentication.ts';

test('only an explicit OS cancellation receives the private cancellation identity', () => {
  const cancelled = operationAuthenticationCancellation();
  assert(cancelled instanceof Error);
  assert.equal(cancelled.message, 'CANCELLED');
  assert.equal(isOperationAuthenticationCancellation(cancelled), true);
  assert.equal(isOperationAuthenticationCancellation(new Error('CANCELLED')), false);
});

test('serialization, copying and lookalike fields cannot forge explicit cancellation', () => {
  const cancelled = operationAuthenticationCancellation();
  for (const candidate of [null, undefined, 'CANCELLED', { message: 'CANCELLED' },
    { ...cancelled }, Object.assign(new Error('CANCELLED'), { code: 'CANCELLED' }),
    JSON.parse(JSON.stringify(cancelled))]) {
    assert.equal(isOperationAuthenticationCancellation(candidate), false);
  }
});

test('separate explicit cancellations remain independently branded', () => {
  const first = operationAuthenticationCancellation(), second = operationAuthenticationCancellation();
  assert.notEqual(first, second);
  assert.equal(isOperationAuthenticationCancellation(first), true);
  assert.equal(isOperationAuthenticationCancellation(second), true);
});
