jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: jest.fn(),
    getState: () => ({ vault: {} }),
  },
}));

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
