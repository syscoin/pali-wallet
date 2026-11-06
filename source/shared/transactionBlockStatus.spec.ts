import {
  getTransactionBlockInfo,
  isTransactionInBlock,
} from './transactionBlockStatus';
import { mergeAccountSummaryWithFullTransaction } from './utxoTransactionDetails';

it.each([
  { blockNumber: 42 },
  { blockNumber: '0x2a' },
  { blockHeight: '42' },
  { height: BigInt(42) },
  { blockNumber: { valueOf: null, toString: null }, blockHeight: 42 },
])('returns the same numeric height from supported observations: %o', (tx) => {
  expect(getTransactionBlockInfo(tx)).toBe(42);
  expect(isTransactionInBlock(tx)).toBe(true);
});

it.each([[42], true, 1.5, '1e3', '9007199254740993', 0])(
  'rejects non-canonical or unsafe block placement: %o',
  (blockNumber) => {
    const tx = { blockNumber };
    expect(getTransactionBlockInfo(tx)).toBeNull();
    expect(isTransactionInBlock(tx)).toBe(false);
  }
);

it('does not retain a height alias from an older detail when a newer summary is pending', () => {
  const row = {
    blockHash: '',
    blockHeight: 0,
    blockTime: 0,
    fees: '0',
    hex: '',
    txid: 'a'.repeat(64),
    value: '0',
    valueIn: '0',
    version: 2,
    vin: [],
    vout: [],
  };
  const merged = mergeAccountSummaryWithFullTransaction(
    { ...row, confirmations: 0 },
    { ...row, blockNumber: '0x2a', height: 42, confirmations: 1 },
    undefined
  );
  expect(getTransactionBlockInfo(merged)).toBeNull();
  expect(merged.confirmations).toBe(0);
});
