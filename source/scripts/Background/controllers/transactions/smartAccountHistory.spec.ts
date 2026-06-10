jest.unmock('@ethersproject/abi');
jest.unmock('@ethersproject/address');
jest.unmock('@ethersproject/bignumber');
jest.unmock('@ethersproject/bytes');
jest.unmock('@ethersproject/hash');
jest.unmock('@ethersproject/keccak256');
jest.unmock('@ethersproject/strings');

const dispatchMock = jest.fn();
let vaultState: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    dispatch: (action: any) => dispatchMock(action),
    getState: () => ({ vault: vaultState }),
  },
}));

jest.mock('state/vault', () => ({
  setActiveAccountProperty: (payload: any) => ({
    payload,
    type: 'vault/setActiveAccountProperty',
  }),
}));

import {
  PALI_ENTRYPOINT_V09_ADDRESS,
  paliEntryPointInterface,
} from 'utils/smartAccount';

import { fetchSmartAccountUserOpTransactions } from './smartAccountHistory';

const SMART_ACCOUNT = '0x9999999999999999999999999999999999999999';
const GAS_PAYER = '0x8888888888888888888888888888888888888888';
const CHAIN_ID = 57;
const TX_HASH = `0x${'ab'.repeat(32)}`;
const BLOCK_HASH = `0x${'cd'.repeat(32)}`;
const USER_OP_HASH = `0x${'11'.repeat(32)}`;

const buildUserOpEventLog = (success: boolean) => {
  const { data, topics } = paliEntryPointInterface.encodeEventLog(
    paliEntryPointInterface.getEvent('UserOperationEvent'),
    [
      USER_OP_HASH,
      SMART_ACCOUNT,
      '0x0000000000000000000000000000000000000000',
      1,
      success,
      1000,
      2000,
    ]
  );
  return {
    address: PALI_ENTRYPOINT_V09_ADDRESS,
    blockHash: BLOCK_HASH,
    blockNumber: 5,
    data,
    topics,
    transactionHash: TX_HASH,
  };
};

const rawOuterTransaction = {
  blockHash: BLOCK_HASH,
  blockNumber: '0x5',
  from: GAS_PAYER,
  gas: '0x5208',
  gasPrice: '0x3b9aca00',
  hash: TX_HASH,
  input: '0x765e827f',
  nonce: '0x1',
  to: PALI_ENTRYPOINT_V09_ADDRESS,
  value: '0x0',
};

const buildProvider = (overrides: Partial<Record<string, any>> = {}) => ({
  getBlockNumber: jest.fn().mockResolvedValue(100),
  getLogs: jest.fn().mockResolvedValue([buildUserOpEventLog(true)]),
  send: jest.fn(async (method: string) => {
    if (method === 'eth_getTransactionByHash') {
      return rawOuterTransaction;
    }
    if (method === 'eth_getBlockByNumber') {
      return { timestamp: '0x60' };
    }
    return null;
  }),
  sendBatch: jest.fn(),
  ...overrides,
});

describe('smart account EntryPoint log history', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    vaultState = {
      accountTransactions: {
        SmartAccount: { 0: { ethereum: { [CHAIN_ID]: [] }, syscoin: {} } },
      },
      accounts: {
        SmartAccount: {
          0: { address: SMART_ACCOUNT, smartAccountUserOpScanByChainId: {} },
        },
      },
      activeAccount: { id: 0, type: 'SmartAccount' },
    };
  });

  it('maps UserOperationEvent logs to outer transactions owned by the smart account', async () => {
    const provider = buildProvider();
    const account = vaultState.accounts.SmartAccount[0];

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      account,
      CHAIN_ID
    );

    expect(provider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: PALI_ENTRYPOINT_V09_ADDRESS,
        fromBlock: 0,
        toBlock: 100,
        topics: [
          paliEntryPointInterface.getEventTopic('UserOperationEvent'),
          null,
          `0x000000000000000000000000${SMART_ACCOUNT.slice(2)}`,
        ],
      })
    );
    expect(transactions).toHaveLength(1);
    const tx = transactions[0] as any;
    expect(tx.hash).toBe(TX_HASH);
    expect(tx.from).toBe(GAS_PAYER);
    expect(tx.to).toBe(PALI_ENTRYPOINT_V09_ADDRESS);
    expect(tx.input).toBe('0x765e827f');
    expect(tx.blockNumber).toBe(5);
    expect(tx.confirmations).toBe(95);
    expect(tx.timestamp).toBe(0x60);
    expect(tx.nonce).toBe(1);
    expect(tx.txreceipt_status).toBe('1');
    expect(tx.isError).toBe('0');
    expect(tx.smartAccountExecution).toBe(true);
    expect(tx.smartAccountExecutionFrom).toBe(SMART_ACCOUNT);
  });

  it('marks reverted user operations as failed', async () => {
    const provider = buildProvider({
      getLogs: jest.fn().mockResolvedValue([buildUserOpEventLog(false)]),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    const tx = transactions[0] as any;
    expect(tx.txreceipt_status).toBe('0');
    expect(tx.isError).toBe('1');
  });

  it('persists the scan cursor and resumes behind it with a reorg safety window', async () => {
    const provider = buildProvider();
    await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          property: 'smartAccountUserOpScanByChainId',
          value: { [CHAIN_ID]: 100 },
        },
      })
    );

    const resumedProvider = buildProvider({
      getLogs: jest.fn().mockResolvedValue([]),
    });
    await fetchSmartAccountUserOpTransactions(
      resumedProvider as any,
      {
        address: SMART_ACCOUNT,
        smartAccountUserOpScanByChainId: { [CHAIN_ID]: 100 },
      },
      CHAIN_ID
    );
    expect(resumedProvider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 95, toBlock: 100 })
    );
  });

  it('refreshes confirmations for already-confirmed vault transactions without refetching', async () => {
    vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [
      {
        blockHash: BLOCK_HASH,
        blockNumber: 5,
        confirmations: 1,
        hash: TX_HASH,
        smartAccountExecutionFrom: SMART_ACCOUNT,
      },
    ];
    const provider = buildProvider();

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    expect(provider.send).not.toHaveBeenCalled();
    expect(transactions).toHaveLength(1);
    expect((transactions[0] as any).confirmations).toBe(95);
  });

  it('refetches and replaces a cached transaction moved by a shallow reorg', async () => {
    const STALE_BLOCK_HASH = `0x${'ee'.repeat(32)}`;
    vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [
      {
        blockHash: STALE_BLOCK_HASH,
        blockNumber: 4,
        confirmations: 1,
        hash: TX_HASH,
        smartAccountExecutionFrom: SMART_ACCOUNT,
      },
    ];
    // The fresh log carries the canonical (post-reorg) block hash, which
    // disagrees with the cached copy, so the outer tx must be refetched.
    const provider = buildProvider();

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    expect(provider.send).toHaveBeenCalledWith('eth_getTransactionByHash', [
      TX_HASH,
    ]);
    const matching = transactions.filter(
      (tx: any) => String(tx.hash).toLowerCase() === TX_HASH
    );
    expect(matching).toHaveLength(1);
    expect((matching[0] as any).blockHash).toBe(BLOCK_HASH);
    expect((matching[0] as any).blockNumber).toBe(5);
  });

  it('does not advance the cursor when a bounded fallback scan leaves a gap', async () => {
    // Full-range scan (fromBlock 0) is rejected; the bounded fallback only
    // covers [latest - 10000, latest], leaving older blocks unindexed.
    const provider = buildProvider({
      getBlockNumber: jest.fn().mockResolvedValue(50_000),
      getLogs: jest
        .fn()
        .mockRejectedValueOnce(new Error('range too large'))
        .mockResolvedValueOnce([buildUserOpEventLog(true)]),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    expect(provider.getLogs).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ fromBlock: 40_000, toBlock: 50_000 })
    );
    // The bounded window still yields transactions...
    expect(transactions).toHaveLength(1);
    // ...but the cursor must not be persisted, so the next poll retries the
    // full range instead of permanently skipping blocks 0..40000.
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('advances the cursor when the bounded fallback window covers the previous cursor', async () => {
    const provider = buildProvider({
      getBlockNumber: jest.fn().mockResolvedValue(50_000),
      getLogs: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient error'))
        .mockResolvedValueOnce([]),
    });

    await fetchSmartAccountUserOpTransactions(
      provider as any,
      {
        address: SMART_ACCOUNT,
        smartAccountUserOpScanByChainId: { [CHAIN_ID]: 49_000 },
      },
      CHAIN_ID
    );

    // Intended range starts at 48995 (cursor - reorg window); the fallback
    // window starts at 40000, so nothing was skipped.
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          property: 'smartAccountUserOpScanByChainId',
          value: { [CHAIN_ID]: 50_000 },
        },
      })
    );
  });

  it('does not advance the cursor when transaction details fail to load', async () => {
    // The log scan succeeds but eth_getTransactionByHash transiently returns
    // null for the outer transaction; advancing the cursor would permanently
    // skip this user operation once it falls out of the reorg window.
    const provider = buildProvider({
      send: jest.fn(async (method: string) => {
        if (method === 'eth_getTransactionByHash') {
          return null;
        }
        if (method === 'eth_getBlockByNumber') {
          return { timestamp: '0x60' };
        }
        return null;
      }),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    expect(transactions).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Once the details load on a later poll, the cursor advances again.
    const retryProvider = buildProvider();
    await fetchSmartAccountUserOpTransactions(
      retryProvider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          property: 'smartAccountUserOpScanByChainId',
          value: { [CHAIN_ID]: 100 },
        },
      })
    );
  });

  it('keeps local history when eth_getLogs fails entirely', async () => {
    vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [
      {
        blockHash: BLOCK_HASH,
        blockNumber: 5,
        confirmations: 1,
        hash: TX_HASH,
        smartAccountExecutionFrom: SMART_ACCOUNT,
      },
    ];
    const provider = buildProvider({
      getLogs: jest.fn().mockRejectedValue(new Error('range too large')),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      CHAIN_ID
    );

    // Both the full-range and bounded-window attempts failed.
    expect(provider.getLogs).toHaveBeenCalledTimes(2);
    expect(transactions).toHaveLength(1);
    expect((transactions[0] as any).confirmations).toBe(95);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});
