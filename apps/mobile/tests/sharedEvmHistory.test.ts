import assert from 'node:assert/strict';
import test from 'node:test';
import { EVM_TRANSACTION_HISTORY_SOURCE, belongsToEvmHistoryAccount, getEvmHistoryDirection, mapEvmExplorerTransaction, mergeEvmExplorerTransactions, selectEvmHistoryRepresentatives } from '../../../source/shared/evmHistory.ts';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

test('shared explorer merge keeps the real transaction body and token ownership together', () => {
  const base = mapEvmExplorerTransaction({ hash: hash(1), from: other, to: contract, nonce: '2', timeStamp: '1700000000', txreceipt_status: '0', isError: '0' }, 4444);
  const event = { hash: hash(1).toUpperCase(), from: other, to: owner, contractAddress: contract, value: '5', timeStamp: '1700000000' };
  const rows = mergeEvmExplorerTransactions([base], [event], 4444, true);
  assert.equal(rows.length, 1);
  const row = rows[0]; assert.ok(row);
  assert.equal(row.to, contract);
  assert.equal(row.tokenRecipient, owner);
  assert.equal(row.txreceipt_status, '0');
  assert.equal(row.isError, '1');
  assert.equal(getEvmHistoryDirection(row, owner), 'received');
  assert.equal(belongsToEvmHistoryAccount(row, owner), true);
});

test('shared representative selection preserves sender identity, reorg placement and input rows', () => {
  const first = { hash: hash(1), from: owner, nonce: 2, confirmations: 10, blockNumber: 1, blockHash: hash(10), timestamp: 100 };
  const reorg = { ...first, confirmations: 1, blockNumber: 3, blockHash: hash(11), timestamp: 200 };
  const incoming = { ...first, hash: hash(2), from: other };
  const rows = [first, incoming, reorg];
  const before = JSON.stringify(rows);
  const selected = selectEvmHistoryRepresentatives(rows);
  assert.equal(selected.length, 2);
  assert.equal(selected.find((row) => row.hash === hash(1))?.blockHash, hash(11));
  assert.equal(selected.find((row) => row.hash === hash(1))?.timestamp, 100);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(getEvmHistoryDirection({ from: other, to: contract }, owner, [{ from: owner, to: other }, { from: other, to: owner }]), 'self');
});


test('normalized explorer pages replace local signed summaries by hash without retaining invented receipt fields', () => {
  const local = { hash: hash(3), value: '9007199254740993000000001', nonce: '8', timestamp: 100, historySource: EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned as string };
  const remote = { ...local, hash: hash(3).toUpperCase(), blockNumber: 42, blockHash: hash(30), confirmations: 3, txreceipt_status: '0', historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction as string };
  const before = JSON.stringify([local, remote]);
  const rows = mergeEvmExplorerTransactions([local], [], 4444, false, [remote]);
  assert.equal(rows.length, 1); const row = rows[0]; assert.ok(row); assert.equal(row, remote);
  assert.ok('txreceipt_status' in row); assert.equal(row.txreceipt_status, '0');
  assert.equal(row.value, local.value);
  assert.equal(JSON.stringify([local, remote]), before);
  assert.equal(Object.hasOwn(local, 'blockNumber'), false);
});

test('normalized merge retains full-base precedence over token placeholders and local rows', () => {
  const full = { hash: hash(4), value: '0', input: '0xabcdef', timestamp: 10, historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction as string, tokenRecipient: owner };
  const local = { ...full, value: '7', historySource: EVM_TRANSACTION_HISTORY_SOURCE.LocalSigned as string };
  const event = { ...full, hash: full.hash.toUpperCase(), value: '999', historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer as string };
  for (const first of [local, event]) {
    const result = mergeEvmExplorerTransactions([first], [], 4444, false, [full]);
    assert.equal(result.length, 1); assert.equal(result[0], full);
  }
  for (const later of [local, event]) {
    const result = mergeEvmExplorerTransactions([full], [], 4444, false, [later]);
    assert.equal(result.length, 1); assert.equal(result[0], full);
  }
  assert.equal(mergeEvmExplorerTransactions([local], [], 4444, false, [event])[0], local);
});

test('normalized merge keeps initial full rows at equal priority and still annotates raw token events', () => {
  const full = { hash: hash(5), from: other, to: contract, value: '0', timestamp: 10, historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction as string };
  const later = { ...full, value: '99', timestamp: 11 };
  const event = { hash: full.hash.toUpperCase(), from: other, to: owner, contractAddress: contract, value: '5', timeStamp: '1700000000' };
  const rows = mergeEvmExplorerTransactions([full], [event], 4444, true, [later]);
  assert.equal(rows.length, 1); const row = rows[0]; assert.ok(row); assert.equal(row.value, '0');
  assert.ok('tokenRecipient' in row); assert.equal(row.tokenRecipient, owner);
  assert.equal(row.to, contract);
});
