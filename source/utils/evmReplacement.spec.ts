/* eslint-disable camelcase -- Explorer receipt field uses txreceipt_status. */
import { EVM_TRANSACTION_HISTORY_SOURCE } from './evmNonce';
import {
  buildEvmMinedNonceIndex,
  buildEvmTransactionHashIndex,
  getEvmReplacementRootHash,
  getEvmSettlementStatus,
  hasEvmCancellationIntent,
} from './evmReplacement';

const SENDER = `0x${'11'.repeat(20)}`;
const OTHER = `0x${'22'.repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const original = (fields: any = {}) => ({
  hash: hash('a'),
  from: SENDER,
  to: OTHER,
  nonce: 8,
  chainId: 5700,
  type: 2,
  blockNumber: null,
  value: '1000000000000000000',
  ...fields,
});
const winner = (fields: any = {}) =>
  original({
    hash: hash('b'),
    to: SENDER,
    value: '0',
    blockNumber: 987446,
    txreceipt_status: '1',
    ...fields,
  });
const status = (tx: any, rows: any[] = []) =>
  getEvmSettlementStatus(tx, 5700, buildEvmMinedNonceIndex(rows, 5700));

it('keeps a submitted replacement pending until a competing hash mines', () => {
  const tx = original({ isReplaced: true, status: 'replaced' });
  expect(status(tx, [winner({ blockNumber: null })])).toBe(
    'replacementPending'
  );
  expect(status(tx, [winner()])).toBe('replaced');
});

it('does not require wallet purpose metadata to prove nonce consumption', () => {
  expect(status(original(), [winner()])).toBe('replaced');
  expect(hasEvmCancellationIntent(winner(), [], 5700)).toBe(false);
});

it('lets the original own receipt win stale replacement flags', () => {
  expect(
    status(original({ blockNumber: 987447, isReplaced: true }), [winner()])
  ).toBe('confirmed');
  expect(
    status(
      original({
        blockNumber: 987447,
        isReplaced: true,
        txreceipt_status: '0',
      }),
      [winner()]
    )
  ).toBe('failed');
});

it.each([0, '0', '0x0'])(
  'uses explicit receipt failure %s rather than conflicting explorer success',
  (receipt) =>
    expect(status(winner({ txreceipt_status: receipt, isError: '0' }))).toBe(
      'failed'
    )
);

it.each([1, '1', '0x1'])(
  'uses explicit receipt success %s rather than conflicting explorer failure',
  (receipt) =>
    expect(status(winner({ txreceipt_status: receipt, isError: '1' }))).toBe(
      'confirmed'
    )
);

it('a failed competing transaction still consumes its nonce', () => {
  expect(status(original(), [winner({ txreceipt_status: '0' })])).toBe(
    'replaced'
  );
});

it.each([
  { from: OTHER },
  { nonce: 9 },
  { nonce: undefined },
  { nonce: false },
  { nonce: '0x8junk' },
  { nonce: -1 },
  { nonce: Number.MAX_SAFE_INTEGER + 1 },
  { chainId: 57 },
  { historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer },
  { type: '0x7f' },
  { type: undefined, r: undefined, s: undefined, v: undefined },
  { r: '0x0', s: '0x0', v: '0x0' },
])(
  'does not mistake incompatible/unauthenticated history %j for a winner',
  (fields) => {
    expect(status(original(), [winner(fields)])).toBe('pending');
  }
);

it('matches decimal and hex quantities, retaining the actual outer sender for AA', () => {
  const tx = original({ smartAccountExecutionFrom: OTHER, nonce: '0x8' });
  expect(
    status(tx, [winner({ nonce: '8', smartAccountExecutionFrom: OTHER })])
  ).toBe('replaced');
  expect(
    status(tx, [winner({ from: OTHER, smartAccountExecutionFrom: OTHER })])
  ).toBe('pending');
});

it('does not choose between contradictory mined hashes for the same nonce', () => {
  expect(status(original(), [winner(), winner({ hash: hash('c') })])).toBe(
    'pending'
  );
});

it('mined cancellation retains purpose while its settlement is confirmed', () => {
  const tx = winner({ isCancel: true, isSpeedUp: true });
  expect(status(tx)).toBe('confirmed');
  expect(hasEvmCancellationIntent(tx, [], 5700)).toBe(true);
});

it('recovers recorded intent through compatible legacy ancestry', () => {
  const cancel = winner({ blockNumber: null, isCancel: true });
  const speed = winner({
    hash: hash('c'),
    blockNumber: null,
    isSpeedUp: true,
    replacesHash: cancel.hash,
  });
  const latest = winner({ hash: hash('d'), replacesHash: speed.hash });
  expect(hasEvmCancellationIntent(latest, [speed, cancel], 5700)).toBe(true);
  expect(
    hasEvmCancellationIntent(latest, [speed, { ...cancel, from: OTHER }], 5700)
  ).toBe(false);
  expect(
    hasEvmCancellationIntent(latest, [speed, { ...cancel, nonce: 9 }], 5700)
  ).toBe(false);
  expect(
    hasEvmCancellationIntent(latest, [speed, { ...cancel, chainId: 57 }], 5700)
  ).toBe(false);
});

it('missing ancestors and cycles remain neutral', () => {
  const tx = winner({ hash: hash('c'), replacesHash: hash('d') });
  const cycle = winner({ hash: hash('d'), replacesHash: hash('c') });
  expect(hasEvmCancellationIntent(tx, [], 5700)).toBe(false);
  expect(hasEvmCancellationIntent(tx, [tx, cycle], 5700)).toBe(false);
});

it('migrates only a complete compatible root path before dropping legacy hops', () => {
  const root = original();
  const cancel = winner({ blockNumber: null, replacesHash: root.hash });
  const speed = winner({ hash: hash('c'), replacesHash: cancel.hash });
  const rows = [root, cancel, speed];
  expect(
    getEvmReplacementRootHash(speed, 5700, buildEvmTransactionHashIndex(rows))
  ).toBe(root.hash);
  expect(
    getEvmReplacementRootHash(
      speed,
      5700,
      buildEvmTransactionHashIndex([speed, cancel])
    )
  ).toBeUndefined();
  expect(
    getEvmReplacementRootHash(
      speed,
      5700,
      buildEvmTransactionHashIndex([speed, { ...cancel, nonce: 9 }, root])
    )
  ).toBeUndefined();
  expect(
    getEvmReplacementRootHash(
      speed,
      5700,
      buildEvmTransactionHashIndex([
        speed,
        { ...cancel, replacesHash: speed.hash },
      ])
    )
  ).toBeUndefined();
});

it('does not apply cancellation intent from an explicitly different chain', () => {
  expect(
    hasEvmCancellationIntent(winner({ chainId: 57, isCancel: true }), [], 5700)
  ).toBe(false);
  expect(status(winner({ chainId: 57 }))).toBe('pending');
});
