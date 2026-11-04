import assert from 'node:assert/strict';
import test from 'node:test';
import { belongsToEvmHistoryAccount, getEvmHistoryDirection, mapEvmExplorerTransaction, mergeEvmExplorerTransactions, selectEvmHistoryRepresentatives } from '../../../source/shared/evmHistory.ts';

const owner = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const contract = '0x3333333333333333333333333333333333333333';
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

test('shared explorer merge keeps the real transaction body and token ownership together', () => {
  const base = mapEvmExplorerTransaction({ hash: hash(1), from: other, to: contract, nonce: '2', timeStamp: '1700000000', txreceipt_status: '0', isError: '0' }, 4444);
  const event = { hash: hash(1).toUpperCase(), from: other, to: owner, contractAddress: contract, value: '5', timeStamp: '1700000000' };
  const rows = mergeEvmExplorerTransactions([base], [event], 4444, true);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to, contract);
  assert.equal(rows[0].tokenRecipient, owner);
  assert.equal(rows[0].txreceipt_status, '0');
  assert.equal(rows[0].isError, '1');
  assert.equal(getEvmHistoryDirection(rows[0], owner), 'received');
  assert.equal(belongsToEvmHistoryAccount(rows[0], owner), true);
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
