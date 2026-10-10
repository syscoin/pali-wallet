/* eslint-disable camelcase -- Explorer receipt field uses txreceipt_status. */
import { KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_HISTORY_SOURCE } from 'utils/evmNonce';
import {
  buildEvmMinedNonceIndex,
  getEvmSettlementStatus,
  hasEvmCancellationIntent,
} from 'utils/evmReplacement';

import reducer, {
  setAccountTransactions,
  setSingleTransactionToState,
} from './index';
import { TransactionsType } from './types';

const CHAIN = 5700;
const SENDER = `0x${'11'.repeat(20)}`;
const RECIPIENT = `0x${'22'.repeat(20)}`;
const SMART = `0x${'33'.repeat(20)}`;
const hash = (byte: string) => `0x${byte.repeat(64)}`;
const ROOT = hash('a');
const PARENT = hash('b');
const WINNER = hash('c');
const tx = (txHash: string, fields: any = {}) => ({
  hash: txHash,
  chainId: CHAIN,
  from: SENDER,
  to: RECIPIENT,
  nonce: 8,
  value: '1000000000000000000',
  type: 2,
  r: '0xabc',
  s: '0xdef',
  v: 1,
  blockNumber: null,
  confirmations: 0,
  ...fields,
});
const initial = () => reducer(undefined, { type: 'test/init' });
const rows = (state: ReturnType<typeof reducer>) =>
  state.accountTransactions[KeyringAccountType.HDAccount][0].ethereum[
    CHAIN
  ] as any[];
const insert = (state: ReturnType<typeof reducer>, transaction: any) =>
  reducer(
    state,
    setSingleTransactionToState({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chainId: CHAIN,
      networkType: TransactionsType.Ethereum,
      transaction,
    })
  );
const refresh = (state: ReturnType<typeof reducer>, transactions: any[]) =>
  reducer(
    state,
    setAccountTransactions({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      chainId: CHAIN,
      networkType: TransactionsType.Ethereum,
      transactions,
    })
  );
const root = (fields: any = {}) =>
  tx(ROOT, { isReplaced: true, status: 'replaced', ...fields });
const localWinner = (fields: any = {}) =>
  tx(WINNER, {
    to: SENDER,
    value: '0',
    isCancel: true,
    isSpeedUp: true,
    replacesHash: PARENT,
    replacementRootHash: ROOT,
    ...fields,
  });
// Explorer refreshes may omit local intent and previously verified type/signature.
const incomingWinner = (fields: any = {}) => ({
  hash: WINNER,
  chainId: CHAIN,
  from: SENDER,
  to: SENDER,
  nonce: '0x8',
  value: '0',
  blockNumber: 123,
  confirmations: 2,
  txreceipt_status: '1',
  historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTransaction,
  ...fields,
});
const settlement = (transaction: any, state: ReturnType<typeof reducer>) =>
  getEvmSettlementStatus(
    transaction,
    CHAIN,
    buildEvmMinedNonceIndex(rows(state), CHAIN)
  );

describe('replacement history reducer refresh', () => {
  it('does not retain a mined original with a stale replacement marker solely because an unmined child remains', () => {
    const original = root({
      blockNumber: 124,
      confirmations: 1,
      txreceipt_status: '1',
    });
    let state = insert(
      insert(initial(), original),
      localWinner({ replacesHash: ROOT })
    );
    expect(settlement(original, state)).toBe('confirmed');
    state = refresh(state, []);
    expect(rows(state).some((row) => row.hash === WINNER)).toBe(true);
    expect(rows(state).some((row) => row.hash === ROOT)).toBe(false);
  });

  it('retains the original as replacement pending when its child has only weak confirmation and default block-hash hints', () => {
    let state = insert(
      insert(initial(), root()),
      localWinner({ replacesHash: ROOT })
    );
    state = refresh(state, [
      incomingWinner({
        blockNumber: null,
        confirmations: 1,
        blockHash: hash('0'),
      }),
    ]);
    const original = rows(state).find((row) => row.hash === ROOT);
    const child = rows(state).find((row) => row.hash === WINNER);
    expect(original).toBeDefined();
    expect(buildEvmMinedNonceIndex(rows(state), CHAIN).size).toBe(0);
    expect(settlement(original, state)).toBe('replacementPending');
    expect(settlement(child, state)).toBe('pending');
  });

  it('retains the original across child-only pending and mined refreshes with the correct settlement', () => {
    let state = insert(
      insert(initial(), root()),
      localWinner({ replacesHash: ROOT })
    );
    state = refresh(state, [
      incomingWinner({ blockNumber: null, confirmations: 0 }),
    ]);
    let original = rows(state).find((row) => row.hash === ROOT);
    expect(original).toBeDefined();
    expect(settlement(original, state)).toBe('replacementPending');
    expect(
      settlement(
        rows(state).find((row) => row.hash === WINNER),
        state
      )
    ).toBe('pending');
    state = refresh(state, [incomingWinner()]);
    original = rows(state).find((row) => row.hash === ROOT);
    expect(original).toBeDefined();
    expect(settlement(original, state)).toBe('replaced');
    expect(
      settlement(
        rows(state).find((row) => row.hash === WINNER),
        state
      )
    ).toBe('confirmed');
  });

  it('carries recorded cancellation intent through child-only refreshes and removes a mined-losing legacy ancestor', () => {
    const recordedCancel = tx(PARENT, {
      isCancel: true,
      isReplaced: true,
      status: 'replaced',
      replacesHash: ROOT,
      to: SENDER,
      value: '0',
    });
    const legacySpeedup = localWinner({
      isCancel: undefined,
      replacementRootHash: undefined,
    });
    let state = insert(
      insert(insert(initial(), root()), recordedCancel),
      legacySpeedup
    );
    for (const incoming of [
      incomingWinner({ blockNumber: null, confirmations: 0 }),
      incomingWinner({ blockNumber: null, confirmations: 0 }),
      incomingWinner(),
    ]) {
      state = refresh(state, [incoming]);
      const speedup = rows(state).find((row) => row.hash === WINNER);
      expect(speedup.replacesHash).toBe(PARENT);
      expect(speedup.isCancel).toBe(true);
      expect(hasEvmCancellationIntent(speedup, rows(state), CHAIN)).toBe(true);
      expect(rows(state).some((row) => row.hash === ROOT)).toBe(true);
      if (incoming.blockNumber)
        expect(rows(state).some((row) => row.hash === PARENT)).toBe(false);
    }
    const original = rows(state).find((row) => row.hash === ROOT);
    expect(original).toBeDefined();
    expect(settlement(original, state)).toBe('replaced');
  });

  it.each([undefined, SMART])(
    'retains the public root and metadata when a strong outer winner refresh omits intent/type/signature (AA owner %s)',
    (owner) => {
      const metadata = owner ? { smartAccountExecutionFrom: owner } : {};
      const old = root(metadata);
      let state = insert(insert(initial(), old), localWinner(metadata));
      for (let attempt = 0; attempt < 2; attempt += 1) {
        state = refresh(state, [incomingWinner()]);
        expect(rows(state)).toHaveLength(2);
        const preservedRoot = rows(state).find((row) => row.hash === ROOT);
        const winner = rows(state).find((row) => row.hash === WINNER);
        expect(preservedRoot).toMatchObject({ hash: ROOT, isReplaced: true });
        expect(winner).toMatchObject({
          isCancel: true,
          isSpeedUp: true,
          replacesHash: PARENT,
          replacementRootHash: ROOT,
          type: 2,
          r: '0xabc',
          s: '0xdef',
          v: 1,
          replacementIndexed: true,
          blockNumber: 123,
          ...(owner ? { smartAccountExecutionFrom: owner } : {}),
        });
        expect(settlement(preservedRoot, state)).toBe('replaced');
        expect(settlement(winner, state)).toBe('confirmed');
      }
    }
  );

  it.each([undefined, SMART])(
    'removes the root tombstone when its indexed winner leaves the refreshed history (AA owner %s)',
    (owner) => {
      const metadata = owner ? { smartAccountExecutionFrom: owner } : {};
      let state = insert(
        insert(initial(), root(metadata)),
        localWinner(metadata)
      );
      state = refresh(state, [incomingWinner()]);
      expect(rows(state).some((row) => row.hash === ROOT)).toBe(true);
      state = refresh(state, []);
      expect(rows(state).some((row) => row.hash === WINNER)).toBe(false);
      expect(rows(state).some((row) => row.hash === ROOT)).toBe(false);
    }
  );

  it.each([
    { from: RECIPIENT },
    { nonce: 9 },
    { chainId: 57 },
    { historySource: EVM_TRANSACTION_HISTORY_SOURCE.ExplorerTokenTransfer },
    { type: '0x7f' },
    { r: '0x0', s: '0x0', v: '0x0' },
  ])(
    'does not prove nonce replacement from an incompatible mined row %j',
    (fields) => {
      const old = root();
      let state = insert(insert(initial(), old), localWinner());
      state = refresh(state, [incomingWinner(fields)]);
      const trackedRoot = rows(state).find((row) => row.hash === ROOT) || old;
      expect(settlement(trackedRoot, state)).toBe('replacementPending');
    }
  );

  it.each(['1', '0'])(
    'uses the original mined receipt %s despite the earlier replacement marker',
    (receipt) => {
      let state = insert(initial(), root());
      state = insert(
        state,
        tx(WINNER, {
          isCancel: true,
          replacesHash: ROOT,
          replacementRootHash: ROOT,
        })
      );
      state = refresh(state, [
        tx(ROOT, {
          blockNumber: 124,
          confirmations: 2,
          txreceipt_status: receipt,
        }),
      ]);
      expect(rows(state)).toHaveLength(1);
      expect(rows(state)[0].isReplaced).toBe(false);
      expect(rows(state)[0].status).not.toBe('replaced');
      expect(settlement(rows(state)[0], state)).toBe(
        receipt === '1' ? 'confirmed' : 'failed'
      );
    }
  );

  it('prioritizes the original own mined receipt even while another attempted replacement is still in history', () => {
    const attemptedCancel = tx(WINNER, {
      isCancel: true,
      replacesHash: ROOT,
      replacementRootHash: ROOT,
    });
    let state = insert(insert(initial(), root()), attemptedCancel);
    state = refresh(state, [
      tx(ROOT, { blockNumber: 124, confirmations: 1, txreceipt_status: '1' }),
      attemptedCancel,
    ]);
    expect(
      settlement(
        rows(state).find((row) => row.hash === ROOT),
        state
      )
    ).toBe('confirmed');
    expect(
      settlement(
        rows(state).find((row) => row.hash === WINNER),
        state
      )
    ).toBe('replaced');
  });
});

it.each([30, 35, 60])(
  'caps a new insertion at 30 when the existing history contains %s rows',
  (count) => {
    const existing = Array.from({ length: count }, (_value, index) =>
      tx(`0x${(index + 100).toString(16).padStart(64, '0')}`, {
        nonce: index + 10,
        blockNumber: index + 100,
        confirmations: 1,
      })
    );
    let state = refresh(initial(), existing);
    expect(rows(state)).toHaveLength(count);
    const newRow = tx(ROOT);
    state = insert(state, newRow);
    expect(rows(state)).toHaveLength(30);
    expect(rows(state)[0].hash).toBe(ROOT);
    expect(
      rows(state)
        .slice(1)
        .map((row) => row.hash)
    ).toEqual(existing.slice(0, 29).map((row) => row.hash));
    state = insert(state, { ...newRow, isCancel: true });
    expect(rows(state)).toHaveLength(30);
    expect(rows(state)[0].isCancel).toBe(true);
  }
);
