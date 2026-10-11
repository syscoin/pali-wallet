import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';
import {
  buildEvmMinedNonceIndex,
  getEvmSettlementStatus,
} from 'utils/evmReplacement';

import {
  compactReplacementWinner,
  getReplacementWinner,
  isReplacementWinner,
  mergeReplacementWinnerIndex,
} from './replacementWinner';

const CHAIN = 5700;
const SENDER = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const original = (fields: any = {}) => ({
  hash: hash('a'),
  chainId: CHAIN,
  from: SENDER,
  to: OTHER,
  nonce: '0x8',
  type: '0x2',
  r: hash('1'),
  s: hash('2'),
  v: 0,
  blockNumber: null,
  ...fields,
});
const winner = (fields: any = {}) => ({
  ...original(),
  hash: hash('b'),
  from: SENDER.toUpperCase().replace('0X', '0x'),
  nonce: '8',
  blockNumber: '0x7b',
  ...fields,
});

describe('scoped paginated replacement winner proof', () => {
  it('preserves a strong outer-tuple proof while omitting transaction payload and unrelated provider fields', () => {
    const mined = winner({
      input: '0x' + '01'.repeat(4000),
      value: '1000000000000000000',
      gas: '21000',
      logs: [{ nested: { metadata: 'private fixture marker' } }],
      isCancel: true,
    });
    const proof = getReplacementWinner(original(), [original(), mined], CHAIN);
    expect(proof?.hash).toBe(mined.hash);
    expect(isReplacementWinner(original(), proof, CHAIN)).toBe(true);
    expect(JSON.stringify(proof).length).toBeLessThan(2048);
    for (const field of ['input', 'data', 'value', 'gas', 'logs', 'isCancel'])
      expect(proof).not.toHaveProperty(field);
  });

  it.each([
    { from: OTHER },
    { nonce: '0x9' },
    { chainId: 1 },
    { hash: hash('a') },
    { blockNumber: null, confirmations: 10, blockHash: hash('c') },
    { historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer },
    { type: '0x7f' },
    { r: '0x0', s: '0x0', v: '0x0' },
    { type: undefined, r: undefined, s: undefined, v: undefined },
  ])(
    'rejects a candidate that cannot prove the original outer nonce was consumed %j',
    (fields) => {
      const candidate = winner(fields);
      expect(isReplacementWinner(original(), candidate, CHAIN)).toBe(false);
      expect(
        getReplacementWinner(original(), [candidate], CHAIN)
      ).toBeUndefined();
      const index = buildEvmMinedNonceIndex([], CHAIN);
      expect(
        mergeReplacementWinnerIndex([], original(), candidate, CHAIN, index)
      ).toBe(index);
    }
  );

  it.each(['1', '0'])(
    'keeps the original own mined receipt %s authoritative over another winner',
    (receipt) => {
      // eslint-disable-next-line camelcase -- Provider receipt field.
      const own = original({ blockNumber: 124, txreceipt_status: receipt });
      expect(isReplacementWinner(own, winner(), CHAIN)).toBe(false);
      expect(getReplacementWinner(own, [winner()], CHAIN)).toBeUndefined();
      const index = mergeReplacementWinnerIndex([], own, winner(), CHAIN);
      expect(getEvmSettlementStatus(own, CHAIN, index)).toBe(
        receipt === '1' ? 'confirmed' : 'failed'
      );
    }
  );

  it('does not choose between conflicting mined hashes in the loaded list', () => {
    const candidates = [winner(), winner({ hash: hash('c') })];
    expect(getReplacementWinner(original(), candidates, CHAIN)).toBeUndefined();
  });

  it('preserves live ambiguity and does not mutate the caller index when adding a route proof', () => {
    const subject = original({ isReplaced: true });
    const history = [winner({ hash: hash('c') })];
    const initial = buildEvmMinedNonceIndex(history, CHAIN);
    const merged = mergeReplacementWinnerIndex(
      history,
      subject,
      winner(),
      CHAIN,
      initial
    );
    expect(merged).not.toBe(initial);
    expect([...initial.values()][0].size).toBe(1);
    expect([...merged.values()][0].size).toBe(2);
    expect(getEvmSettlementStatus(subject, CHAIN, merged)).toBe(
      'replacementPending'
    );
  });

  it('uses a live same-hash pending row over its old mined route snapshot', () => {
    const live = winner({ blockNumber: null });
    const initial = buildEvmMinedNonceIndex([live], CHAIN);
    const merged = mergeReplacementWinnerIndex(
      [live],
      original(),
      winner(),
      CHAIN,
      initial
    );
    expect(merged).toBe(initial);
    expect(merged.size).toBe(0);
    expect(getEvmSettlementStatus(original(), CHAIN, merged)).toBe('pending');
  });

  it.each([
    { nonce: { nested: 8 } },
    { blockNumber: [123] },
    { blockNumber: { valueOf: 0, toString: 0 } },
    { r: { nested: '0x01' } },
    { historySource: 'x'.repeat(131) },
    { blockNumber: '1'.repeat(131) },
    { blockNumber: Number.POSITIVE_INFINITY },
    { blockNumber: Number.NaN },
    { type: Number.POSITIVE_INFINITY },
  ])(
    'rejects malformed or unbounded projected fields without coercion exceptions %j',
    (fields) => {
      const candidate = winner(fields);
      expect(() => compactReplacementWinner(candidate, CHAIN)).not.toThrow();
      expect(compactReplacementWinner(candidate, CHAIN)).toBeUndefined();
      expect(() =>
        mergeReplacementWinnerIndex([], original(), candidate, CHAIN)
      ).not.toThrow();
      expect(
        mergeReplacementWinnerIndex([], original(), candidate, CHAIN).size
      ).toBe(0);
    }
  );
});
