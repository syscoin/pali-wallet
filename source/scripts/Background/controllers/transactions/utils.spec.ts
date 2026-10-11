jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: {} }),
  },
}));

import reducer, {
  setAccountTransactions,
  setSingleTransactionToState,
} from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import { KeyringAccountType } from 'types/network';

import { treatAndSortTransactions } from './utils';

const FROM = '0x7777777777777777777777777777777777777777';
const TX_HASH = `0x${'ab'.repeat(32)}`;
const BLOCK_HASH_OLD = `0x${'cd'.repeat(32)}`;
const BLOCK_HASH_NEW = `0x${'ef'.repeat(32)}`;

const baseTx = {
  from: FROM,
  hash: TX_HASH,
  nonce: 1,
  timestamp: 1000,
  to: '0x6666666666666666666666666666666666666666',
  value: '0',
};

describe('treatAndSortTransactions reorg handling', () => {
  it('replaces a cached row when a mined duplicate carries a different blockHash', async () => {
    // Vault row first (merge order in validateAndManageUserTransactions),
    // then the freshly fetched post-reorg row: later block, fewer
    // confirmations, different blockHash.
    const vaultRow = {
      ...baseTx,
      blockHash: BLOCK_HASH_OLD,
      blockNumber: 4,
      confirmations: 96,
    };
    const fetchedRow = {
      ...baseTx,
      blockHash: BLOCK_HASH_NEW,
      blockNumber: 5,
      confirmations: 95,
    };

    const result = treatAndSortTransactions([
      vaultRow,
      fetchedRow,
    ] as any) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].blockHash).toBe(BLOCK_HASH_NEW);
    expect(result[0].blockNumber).toBe(5);
    expect(result[0].confirmations).toBe(95);
  });

  it('keeps the cached row when a duplicate has the same blockHash and fewer confirmations', async () => {
    const vaultRow = {
      ...baseTx,
      blockHash: BLOCK_HASH_OLD,
      blockNumber: 4,
      confirmations: 96,
    };
    const staleDuplicate = {
      ...baseTx,
      blockHash: BLOCK_HASH_OLD,
      blockNumber: 4,
      confirmations: 90,
    };

    const result = treatAndSortTransactions([
      vaultRow,
      staleDuplicate,
    ] as any) as any[];

    expect(result).toHaveLength(1);
    expect(result[0].confirmations).toBe(96);
  });
});

describe('replacement attempt timestamps', () => {
  it.each([KeyringAccountType.HDAccount, KeyringAccountType.SmartAccount])(
    'keeps each pending attempt timestamp through repeated refresh and popup rehydration for %s',
    (accountType) => {
      const chainId = 5700;
      const hashes = ['a', 'b', 'c', 'd'].map(
        (digit) => `0x${digit.repeat(64)}`
      );
      const attempts = hashes.map((hash, index) => ({
        ...baseTx,
        hash,
        chainId,
        to: index >= 2 ? FROM : baseTx.to,
        value: index >= 2 ? '0' : '100',
        timestamp: 1000 + index,
        blockNumber: null,
        confirmations: 0,
        type: 2,
        r: '0xabc',
        s: '0xdef',
        v: 1,
        isReplaced: index < 3,
        isSpeedUp: index === 1 || index === 3,
        isCancel: index >= 2,
        ...(index > 0
          ? { replacesHash: hashes[index - 1], replacementRootHash: hashes[0] }
          : {}),
        ...(accountType === KeyringAccountType.SmartAccount
          ? { smartAccountExecutionFrom: baseTx.to }
          : {}),
      }));
      let state = reducer(undefined, { type: 'test/init' });
      const bucket = () =>
        state.accountTransactions[accountType][0].ethereum[chainId] as any[];
      for (const transaction of attempts) {
        state = reducer(
          state,
          setSingleTransactionToState({
            accountId: 0,
            accountType,
            chainId,
            networkType: TransactionsType.Ethereum,
            transaction: transaction as any,
          })
        );
      }

      // Match the real polling merge (vault rows before provider rows) and the
      // reducer that retains other pending attempts ahead of that representative.
      for (let refresh = 0; refresh < 6; refresh += 1) {
        const transactions = treatAndSortTransactions([
          ...bucket(),
          { ...attempts[3], timestamp: 2000 + refresh },
        ] as any);
        state = reducer(
          state,
          setAccountTransactions({
            accountId: 0,
            accountType,
            chainId,
            networkType: TransactionsType.Ethereum,
            transactions,
          })
        );
        state = JSON.parse(JSON.stringify(state));
        expect(bucket()).toHaveLength(4);
        expect(
          bucket()
            .slice()
            .sort((left, right) => right.timestamp - left.timestamp)
            .map(({ hash, timestamp }) => ({ hash, timestamp }))
        ).toEqual(
          attempts
            .slice()
            .reverse()
            .map(({ hash, timestamp }) => ({ hash, timestamp }))
        );
      }
    }
  );

  it('uses a mined replacement own timestamp rather than the losing hash timestamp', () => {
    const original = { ...baseTx, confirmations: 0, blockNumber: null };
    const replacement = {
      ...baseTx,
      hash: `0x${'34'.repeat(32)}`,
      timestamp: 1200,
      confirmations: 1,
      blockNumber: 5,
      blockHash: BLOCK_HASH_NEW,
    };
    expect(treatAndSortTransactions([original, replacement] as any)).toEqual([
      replacement,
    ]);
  });

  it.each([false, true])(
    'preserves the earliest timestamp for versions of the same hash when the incoming row is mined: %s',
    (mined) => {
      const old = {
        ...baseTx,
        timestamp: mined ? 1000 : 1200,
        confirmations: 0,
        blockNumber: null,
      };
      const incoming = {
        ...baseTx,
        timestamp: mined ? 1200 : 1000,
        confirmations: mined ? 1 : 0,
        blockNumber: mined ? 5 : null,
      };
      const [result] = treatAndSortTransactions([
        old,
        incoming,
      ] as any) as any[];
      expect(result.timestamp).toBe(1000);
      expect(result.hash).toBe(TX_HASH);
      expect(result.blockNumber).toBe(incoming.blockNumber);
    }
  );
});
