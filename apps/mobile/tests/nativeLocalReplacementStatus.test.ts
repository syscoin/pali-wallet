import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeLocalReplacementStatuses } from '../src/activity/localReplacementStatus.ts';
import type { ActivityRow } from '../src/activity/nativeActivity.ts';
import { createActivityScope } from '../src/activity/types.ts';

const owner = `0x${'11'.repeat(20)}`, recipient = `0x${'22'.repeat(20)}`;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const scope = createActivityScope('a'.repeat(64), 'hd:60:0', owner, 'ethereum');
const row = (digit: string): ActivityRow => ({ hash: hash(digit), checking: false, unavailable: false,
  local: { walletFingerprint: 'a'.repeat(64), accountId: 'hd:60:0', address: owner,
    registrationHash: scope.network.registrationHash, networkId: 'ethereum', chainId: '1',
    hash: hash(digit), phase: 'submitted', nonce: 7, transactionType: 2,
    createdAt: 1, recipient, amountUnits: '1', maximumFeeUnits: '21000' } });
const original = row('1');
const winner = (operation: 'speed-up' | 'cancel' = 'speed-up', outcome: 'confirmed' | 'reverted' = 'confirmed'): ActivityRow => {
  const value = row('2');
  return { ...value, local: { ...value.local!, operation, originalHash: original.hash },
    retainedObservation: { status: 'mined', outcome,
      block: { number: '42', hash: hash('b') }, transactionIndex: 0 } };
};
const statuses = (...rows: ActivityRow[]) => nativeLocalReplacementStatuses(rows, scope);

for (const operation of ['speed-up', 'cancel'] as const)
  for (const outcome of ['confirmed', 'reverted'] as const)
    test(`included ${outcome} ${operation} replaces its same-nonce original`, () => {
      const replacement = winner(operation, outcome);
      assert.equal(statuses(original, replacement).get(original.hash), 'replaced');
      assert.equal(statuses(original, replacement).has(replacement.hash), false);
    });

test('a linked or previously confirmed local record without current inclusion is not a winner', () => {
  const replacement = winner();
  for (const changed of [
    { retainedObservation: undefined, local: { ...replacement.local!, phase: 'confirmed' as const } },
    { retainedObservation: { status: 'mined' as const, outcome: 'confirmed' as const, block: { number: '42', hash: hash('b') } } },
    { retainedObservation: { status: 'missing' as const, latestNonce: '8' } },
    { checking: true }, { unavailable: true },
    { observation: { hash: replacement.hash, from: owner, to: recipient, nonce: '7',
      status: 'pending' as const, block: null, timestamp: null, valueUnits: '1', events: [], feeUnits: null } },
  ]) assert.equal(statuses(original, { ...replacement, ...changed }).size, 0);
});

test('foreign registration, account, payer, nonce and non-EOA records cannot replace this original', () => {
  const replacement = winner();
  for (const patch of [
    { registrationHash: hash('f') }, { walletFingerprint: 'b'.repeat(64) },
    { accountId: 'hd:60:1' }, { address: recipient }, { nonce: 8 }, { chainId: '2' },
    { networkId: 'base' }, { transactionType: undefined }, { transactionType: 127 },
    { smartAccount: { payer: owner, operations: [{ operationHash: hash('a'), operationNonce: '0' }] } },
  ]) assert.equal(statuses(original, { ...replacement, local: { ...replacement.local!, ...patch } }).size, 0);
  const changedScope = { ...scope, network: { ...scope.network, registrationHash: hash('e') } };
  assert.equal(nativeLocalReplacementStatuses([original, replacement], changedScope).size, 0);
});

test('current own canonical outcomes win and contradictory included siblings remain ambiguous', () => {
  const replacement = winner();
  for (const outcome of ['confirmed', 'reverted'] as const) {
    const own = { ...original, retainedObservation: { status: 'mined' as const, outcome,
      block: { number: '42', hash: hash('b') } } };
    assert.equal(statuses(own, replacement).has(original.hash), false);
  }
  const conflict = winner('cancel');
  const third = row('3');
  assert.equal(statuses(original, replacement, { ...conflict, hash: third.hash, local: third.local }).size, 0);
});

test('fresh direct receipt needs exact identity and inclusion, and a reorg removes its proof', () => {
  const replacement = winner();
  const observation = { hash: replacement.hash, from: owner, to: recipient, nonce: '7',
    status: 'confirmed' as const, block: { number: '42', hash: hash('b') },
    timestamp: 1, valueUnits: '1', events: [], feeUnits: '21000', transactionIndex: 0 };
  const direct = { ...replacement, retainedObservation: undefined, observation };
  assert.equal(statuses(original, direct).get(original.hash), 'replaced');
  for (const patch of [{ hash: hash('f') }, { nonce: '8' }, { from: recipient }, { to: owner },
    { transactionIndex: undefined }, { transactionIndex: -1 }, { transactionIndex: 0.5 },
    { block: { number: '0', hash: hash('b') } }, { block: { number: '42', hash: 'invalid' } }])
    assert.equal(statuses(original, { ...direct, observation: { ...observation, ...patch } }).size, 0);
  assert.equal(statuses(original, { ...direct, observation: { ...observation, status: 'pending', block: null } }).size, 0);
  assert.equal(statuses(original, { ...direct, observation: undefined }).size, 0);
});
