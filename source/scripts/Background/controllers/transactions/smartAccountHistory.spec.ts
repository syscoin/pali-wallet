/* eslint-disable camelcase -- Ethereum RPC fixture fields. */
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
  setAccountPropertyByIdAndType: (payload: any) => ({
    payload,
    type: 'vault/setAccountPropertyByIdAndType',
  }),
}));

import { isEvmHistoryIncomplete } from '../../../../shared/evmHistory';
import {
  PALI_ENTRYPOINT_V09_ADDRESS,
  paliEntryPointInterface,
} from 'utils/smartAccount';

import { fetchSmartAccountUserOpTransactions } from './smartAccountHistory';

const SMART_ACCOUNT = '0x9999999999999999999999999999999999999999';
const GAS_PAYER = '0x8888888888888888888888888888888888888888';
const ACCOUNT_TYPE = 'SmartAccount' as any;
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

const buildProvider = (overrides: Partial<Record<string, any>> = {}) => {
  const provider: any = {
    getBlockNumber: jest.fn().mockResolvedValue(100),
    getLogs: jest.fn().mockResolvedValue([buildUserOpEventLog(true)]),
    send: jest.fn(async (method: string) => {
      if (method === 'eth_chainId') return `0x${CHAIN_ID.toString(16)}`;
      if (method === 'eth_getTransactionByHash') {
        return rawOuterTransaction;
      }
      if (method === 'eth_getBlockByNumber') {
        return { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' };
      }
      return null;
    }),

    ...overrides,
  };
  const send = provider.send;
  provider.send = jest.fn(async (method, params) =>
    method === 'eth_chainId'
      ? overrides.identity?.() ?? `0x${CHAIN_ID.toString(16)}`
      : send(method, params)
  );
  if (provider.readMany) {
    const readMany = provider.readMany;
    provider.readMany = jest.fn(async (requests, options) =>
      requests.length === 1 && requests[0].method === 'eth_chainId'
        ? [{ status: 'fulfilled', value: `0x${CHAIN_ID.toString(16)}` }]
        : readMany(requests, options)
    );
  }
  return provider;
};

const expectCursorDispatch = (block: number) =>
  expect.objectContaining({
    payload: {
      id: 0,
      property: 'smartAccountUserOpScanByChainId',
      type: ACCOUNT_TYPE,
      value: { [CHAIN_ID]: block },
    },
  });

describe('coherent Smart history materialization', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    vaultState = {
      accountTransactions: {
        SmartAccount: { 0: { ethereum: { [CHAIN_ID]: [] } } },
      },
      accounts: {
        SmartAccount: {
          0: {
            id: 0,
            address: SMART_ACCOUNT,
            smartAccountUserOpScanByChainId: {},
          },
        },
      },
    };
  });
  it('reports failed discovery as incomplete and healthy discovery as complete', async () => {
    const provider = buildProvider({
      getLogs: jest
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValue([]),
    });
    const run = () =>
      fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
    expect(isEvmHistoryIncomplete(await run())).toBe(true);
    expect(isEvmHistoryIncomplete(await run())).toBe(false);
  });
  it('renews remote identity after the lease expires before publishing rows or a cursor', async () => {
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    let chain = CHAIN_ID;
    const provider = buildProvider({
      identity: () => `0x${chain.toString(16)}`,
      send: jest.fn(async (method) => {
        if (method === 'eth_chainId') return `0x${chain.toString(16)}`;
        return method === 'eth_getTransactionByHash'
          ? rawOuterTransaction
          : { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' };
      }),
    });
    const run = () =>
      fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
    expect(await run()).toHaveLength(1);
    dispatchMock.mockClear();
    clock.mockReturnValue(60_000);
    chain = 1;
    await expect(run()).rejects.toThrow();
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(provider.getLogs).toHaveBeenCalledTimes(1);
    expect(
      provider.send.mock.calls.filter(([method]) => method === 'eth_chainId')
    ).toHaveLength(2);
    clock.mockRestore();
  });
  it('shares a warm identity but refuses a long scan crossing the lease after retargeting', async () => {
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    let chain = CHAIN_ID;
    const provider = buildProvider({
      identity: () => `0x${chain.toString(16)}`,
      getLogs: jest.fn(async () => []),
    });
    const run = () =>
      fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
    await run();
    clock.mockReturnValue(1000);
    await run();
    expect(
      provider.send.mock.calls.filter(([method]) => method === 'eth_chainId')
    ).toHaveLength(1);
    dispatchMock.mockClear();
    provider.getLogs.mockImplementationOnce(async () => {
      clock.mockReturnValue(31_000);
      chain = 1;
      return [buildUserOpEventLog(true)];
    });
    await expect(run()).rejects.toThrow('History chain changed');
    expect(dispatchMock).not.toHaveBeenCalled();
    clock.mockRestore();
  });
  it.each(['missing', 'conflicting'])(
    'does not bind an unmaterialized %s event outcome to cached placement',
    async (kind) => {
      const cached = {
        ...rawOuterTransaction,
        blockNumber: 5,
        confirmations: 95,
        smartAccountExecutionFrom: SMART_ACCOUNT,
        txreceipt_status: '1',
        isError: '0',
      };
      vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [
        cached,
      ];
      const event = { ...buildUserOpEventLog(false), blockHash: USER_OP_HASH };
      const provider = buildProvider({
        getLogs: jest.fn(async () =>
          kind === 'conflicting' ? [buildUserOpEventLog(false), event] : [event]
        ),
        send: jest.fn(async () => null),
      });
      const rows = await fetchSmartAccountUserOpTransactions(
        provider,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
      expect(rows[0]).toMatchObject({
        blockHash: BLOCK_HASH,
        txreceipt_status: '1',
      });
      expect((rows[0] as any).smartAccountOutcome).toBeUndefined();
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  );
  it.each(['hash', 'header', 'sender'] as const)(
    'rejects a contradictory %s without advancing coverage',
    async (mismatch) => {
      const provider = buildProvider({
        getLogs: jest.fn(async () => [
          {
            ...buildUserOpEventLog(true),
            ...(mismatch === 'sender'
              ? {
                  topics: [
                    buildUserOpEventLog(true).topics[0],
                    USER_OP_HASH,
                    `0x${'00'.repeat(12)}${GAS_PAYER.slice(2)}`,
                    `0x${'00'.repeat(32)}`,
                  ],
                }
              : {}),
          },
        ]),
        send: jest.fn(async (method) =>
          method === 'eth_getTransactionByHash'
            ? {
                ...rawOuterTransaction,
                hash: mismatch === 'hash' ? USER_OP_HASH : TX_HASH,
              }
            : {
                number: '0x5',
                hash: mismatch === 'header' ? USER_OP_HASH : BLOCK_HASH,
                timestamp: '0x60',
              }
        ),
      });
      const rows = await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
      expect(rows).toEqual([]);
      if (mismatch !== 'sender') expect(dispatchMock).not.toHaveBeenCalled();
    }
  );
  it('retries unavailable block metadata without inventing mined time', async () => {
    let available = false;
    const provider = buildProvider({
      send: jest.fn(async (method) =>
        method === 'eth_getTransactionByHash'
          ? rawOuterTransaction
          : available
          ? { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' }
          : null
      ),
    });
    expect(
      await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      )
    ).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    available = true;
    const rows = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(rows[0].timestamp).toBe(96);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
  });
  it('validates every transaction against the canonical hash at a shared height', async () => {
    const other = `0x${'ef'.repeat(32)}`;
    const provider = buildProvider({
      getLogs: jest.fn(async () => [
        buildUserOpEventLog(true),
        {
          ...buildUserOpEventLog(true),
          transactionHash: other,
          blockHash: USER_OP_HASH,
        },
      ]),
      send: jest.fn(async (method, params) =>
        method === 'eth_getTransactionByHash'
          ? {
              ...rawOuterTransaction,
              hash: params[0],
              blockHash: params[0] === other ? USER_OP_HASH : BLOCK_HASH,
            }
          : { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' }
      ),
    });
    const rows = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(rows.map((row) => row.hash)).toEqual([TX_HASH]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
  it('does not overwrite a conflicting duplicate event placement', async () => {
    const provider = buildProvider({
      getLogs: jest.fn(async () => [
        buildUserOpEventLog(true),
        { ...buildUserOpEventLog(true), blockHash: USER_OP_HASH },
      ]),
    });
    expect(
      await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      )
    ).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'keeps coverage unresolved only for malformed relevant logs (relevant=%s)',
    async (relevant) => {
      const log = buildUserOpEventLog(true);
      const provider = buildProvider({
        getLogs: jest.fn(async () => [
          { ...log, data: '0x00', ...(relevant ? {} : { address: GAS_PAYER }) },
        ]),
      });
      expect(
        await fetchSmartAccountUserOpTransactions(
          provider as any,
          vaultState.accounts.SmartAccount[0],
          ACCOUNT_TYPE,
          CHAIN_ID
        )
      ).toEqual([]);
      if (relevant) expect(dispatchMock).not.toHaveBeenCalled();
      else expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
    }
  );
  it('retries a corrected relevant log on the next poll after malformed data', async () => {
    const provider = buildProvider({
      getLogs: jest
        .fn()
        .mockResolvedValueOnce([{ ...buildUserOpEventLog(true), data: '0x' }])
        .mockResolvedValue([buildUserOpEventLog(true)]),
    });
    const account = vaultState.accounts.SmartAccount[0];
    expect(
      await fetchSmartAccountUserOpTransactions(
        provider as any,
        account,
        ACCOUNT_TYPE,
        CHAIN_ID
      )
    ).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    provider.getBlockNumber.mockResolvedValue(101);
    expect(
      (
        await fetchSmartAccountUserOpTransactions(
          provider as any,
          account,
          ACCOUNT_TYPE,
          CHAIN_ID
        )
      ).map((tx) => tx.hash)
    ).toEqual([TX_HASH]);
    expect(provider.getLogs.mock.calls[1][0].fromBlock).toBe(0);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(101));
  });
  it('ignores unrelated malformed evidence alongside a healthy relevant event', async () => {
    const provider = buildProvider({
      getLogs: jest.fn(async () => [
        { ...buildUserOpEventLog(true), data: '0x', address: GAS_PAYER },
        buildUserOpEventLog(true),
      ]),
    });
    const rows = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(rows.map((tx) => tx.hash)).toEqual([TX_HASH]);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
  });
  it('preserves healthy members while malformed relevant evidence holds coverage', async () => {
    const provider = buildProvider({
      getLogs: jest.fn(async () => [
        {
          ...buildUserOpEventLog(true),
          transactionHash: USER_OP_HASH,
          data: '0x',
        },
        buildUserOpEventLog(true),
      ]),
    });
    const rows = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(rows.map((tx) => tx.hash)).toEqual([TX_HASH]);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'retains the canonical sibling regardless of stale same-height order (staleFirst=%s)',
    async (staleFirst) => {
      const other = `0x${'ef'.repeat(32)}`;
      const logs = [
        { ...buildUserOpEventLog(true), blockHash: USER_OP_HASH },
        { ...buildUserOpEventLog(true), transactionHash: other },
      ];
      const provider = buildProvider({
        getLogs: jest.fn(async () => (staleFirst ? logs : [...logs].reverse())),
        send: jest.fn(async (method, params) =>
          method === 'eth_getTransactionByHash'
            ? {
                ...rawOuterTransaction,
                hash: params[0],
                blockHash: params[0] === TX_HASH ? USER_OP_HASH : BLOCK_HASH,
              }
            : { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' }
        ),
      });
      const rows = await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
      expect(rows.map((row) => row.hash)).toEqual([other]);
      expect(dispatchMock).not.toHaveBeenCalled();
    }
  );
  it('advances covered backfill when an optional tip detail remains unavailable', async () => {
    const provider = buildProvider({
      getBlockNumber: jest.fn(async () => 200000),
      getLogs: jest.fn(async (filter) => {
        if (filter.toBlock - filter.fromBlock + 1 > 10000)
          throw Error('block range too large');
        return filter.fromBlock > 100000
          ? [{ ...buildUserOpEventLog(true), blockNumber: 195000 }]
          : [];
      }),
      send: jest.fn(async () => null),
    });
    expect(
      await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      )
    ).toEqual([]);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(99999));
  });
  it('stops after a retired log reply before requesting transaction details', async () => {
    let current = true;
    const provider = buildProvider({
      getLogs: jest.fn(async () => {
        current = false;
        return [buildUserOpEventLog(true)];
      }),
    });
    await expect(
      fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID,
        () => current
      )
    ).rejects.toThrow('History context changed');
    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
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
          0: {
            address: SMART_ACCOUNT,
            id: 0,
            smartAccountUserOpScanByChainId: {},
          },
        },
      },
      activeAccount: { id: 0, type: ACCOUNT_TYPE },
    };
  });

  it('maps UserOperationEvent logs to outer transactions owned by the smart account', async () => {
    const provider = buildProvider();
    const account = vaultState.accounts.SmartAccount[0];

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      account,
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(provider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        address: PALI_ENTRYPOINT_V09_ADDRESS,
        fromBlock: 0,
        toBlock: 100,
        topics: [
          paliEntryPointInterface.getEvent('UserOperationEvent')!.topicHash,
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
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    const tx = transactions[0] as any;
    expect(tx.txreceipt_status).toBe('0');
    expect(tx.isError).toBe('1');
  });

  it('persists the scan cursor on the scanned account and resumes behind it', async () => {
    const provider = buildProvider();
    await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));

    const resumedProvider = buildProvider({
      getLogs: jest.fn().mockResolvedValue([]),
    });
    await fetchSmartAccountUserOpTransactions(
      resumedProvider as any,
      {
        address: SMART_ACCOUNT,
        id: 0,
        smartAccountUserOpScanByChainId: { [CHAIN_ID]: 100 },
      },
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(resumedProvider.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 95, toBlock: 100 })
    );
  });

  it('does not stamp a reused account slot after the first awaited read', async () => {
    let release!: (height: number) => void;
    const provider = buildProvider({
      getBlockNumber: jest.fn(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          })
      ),
      getLogs: jest.fn().mockResolvedValue([]),
    });
    const oldAccount = vaultState.accounts.SmartAccount[0];
    const read = fetchSmartAccountUserOpTransactions(
      provider as any,
      oldAccount,
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    vaultState.accounts.SmartAccount[0] = { id: 0, address: GAS_PAYER };
    await new Promise((resolve) => setImmediate(resolve));
    release(100);
    await read;
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('retains case-insensitive identity and unrelated account updates while inactive', async () => {
    let release!: (logs: any[]) => void;
    const provider = buildProvider({
      getLogs: jest.fn(
        () =>
          new Promise<any[]>((resolve) => {
            release = resolve;
          })
      ),
    });
    const read = fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID,
      () => true
    );
    await new Promise((resolve) => setImmediate(resolve));
    vaultState.accounts.SmartAccount[0] = {
      ...vaultState.accounts.SmartAccount[0],
      address: SMART_ACCOUNT.toUpperCase(),
      label: 'Updated label',
    };
    vaultState.activeAccount = { id: 1, type: ACCOUNT_TYPE };
    release([]);
    await read;
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
  });

  it('rejects a stale lifetime even if the replacement reuses the same address and id', async () => {
    let release!: (logs: any[]) => void;
    let current = true;
    const provider = buildProvider({
      getLogs: jest.fn(
        () =>
          new Promise<any[]>((resolve) => {
            release = resolve;
          })
      ),
    });
    const read = fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID,
      () => current
    );
    await new Promise((resolve) => setImmediate(resolve));
    current = false;
    vaultState.accounts.SmartAccount[0] = { id: 0, address: SMART_ACCOUNT };
    release([]);
    await expect(read).rejects.toThrow('History context changed');
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('does not recreate a removed account while committing a scan cursor', async () => {
    let release!: (logs: any[]) => void;
    const provider = buildProvider({
      getLogs: jest.fn(
        () =>
          new Promise<any[]>((resolve) => {
            release = resolve;
          })
      ),
    });
    const read = fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    await new Promise((resolve) => setImmediate(resolve));
    delete vaultState.accounts.SmartAccount[0];
    release([]);
    await read;
    expect(dispatchMock).not.toHaveBeenCalled();
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
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    expect((transactions[0] as any).confirmations).toBe(95);
  });

  it('applies log-derived inner-op status to cached transactions without refetching', async () => {
    // Locally submitted execution: saved from the successful outer handleOps
    // transaction even though the inner user operation reverted.
    vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [
      {
        blockHash: BLOCK_HASH,
        blockNumber: 5,
        confirmations: 1,
        hash: TX_HASH,
        isError: '0',
        smartAccountExecutionFrom: SMART_ACCOUNT,
        // eslint-disable-next-line camelcase
        txreceipt_status: '1',
      },
    ];
    const provider = buildProvider({
      getLogs: jest.fn().mockResolvedValue([buildUserOpEventLog(false)]),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    // No refetch: block hash matches, only the status is corrected.
    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(transactions).toHaveLength(1);
    const tx = transactions[0] as any;
    expect(tx.txreceipt_status).toBe('0');
    expect(tx.isError).toBe('1');
    expect(tx.confirmations).toBe(95);
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
      ACCOUNT_TYPE,
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

  it.each(['range too large', 'query exceeds max block range 10000'])(
    'backfills range-capped RPCs in chunks after %s',
    async (message) => {
      const provider = buildProvider({
        getBlockNumber: jest.fn().mockResolvedValue(25_000),
        getLogs: jest
          .fn()
          .mockRejectedValueOnce(
            Object.assign(new Error(message), { code: -32602 })
          )
          .mockResolvedValueOnce([buildUserOpEventLog(true)])
          .mockResolvedValue([]),
      });

      const transactions = await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );

      // Full range rejected, then contiguous 10k chunks up to the tip.
      expect(provider.getLogs).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ fromBlock: 0, toBlock: 9_999 })
      );
      expect(provider.getLogs).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({ fromBlock: 10_000, toBlock: 19_999 })
      );
      expect(provider.getLogs).toHaveBeenNthCalledWith(
        4,
        expect.objectContaining({ fromBlock: 20_000, toBlock: 25_000 })
      );
      expect(transactions).toHaveLength(1);
      expect(isEvmHistoryIncomplete(transactions)).toBe(false);
      expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(25_000));
    }
  );

  it('persists partial backfill progress and peeks at the tip window when capped', async () => {
    // 200k blocks: 10 chunks per poll cover 0..99,999; the tip window is
    // queried separately so fresh activity is visible during the backfill.
    const getLogs = jest.fn(async (filter: any) => {
      if (filter.fromBlock === 0 && filter.toBlock === 200_000) {
        throw new Error('range too large');
      }
      if (filter.fromBlock === 190_001) {
        return [{ ...buildUserOpEventLog(true), blockNumber: 195000 }];
      }
      return [];
    });
    const provider = buildProvider({
      getBlockNumber: jest.fn().mockResolvedValue(200_000),
      getLogs,
      send: jest.fn(async (method) =>
        method === 'eth_getTransactionByHash'
          ? { ...rawOuterTransaction, blockNumber: '0x2f9b8' }
          : { number: '0x2f9b8', hash: BLOCK_HASH, timestamp: '0x60' }
      ),
    });

    const transactions = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    // 1 full-range attempt + 10 chunks + 1 tip window.
    expect(getLogs).toHaveBeenCalledTimes(12);
    expect(getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromBlock: 190_001, toBlock: 200_000 })
    );
    // Tip-window transactions are surfaced for display...
    expect(transactions).toHaveLength(1);
    // ...but the cursor only advances through the contiguous covered range.
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(99_999));
  });

  it('stops the backfill at the first failing chunk and persists contiguous progress only', async () => {
    const getLogs = jest.fn(async (filter: any) => {
      if (filter.fromBlock === 0 && filter.toBlock === 50_000) {
        throw new Error('range too large');
      }
      if (filter.fromBlock === 10_000 && filter.toBlock === 19_999) {
        throw new Error('transient chunk failure');
      }
      return [];
    });
    const provider = buildProvider({
      getBlockNumber: jest.fn().mockResolvedValue(50_000),
      getLogs,
    });

    await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    // Coverage is contiguous 0..9,999; the failed chunk is retried from the
    // persisted cursor on the next poll instead of leaving a gap.
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(9_999));
  });

  it('keeps the cursor when a near-tip scan fails for a non-range reason', async () => {
    const provider = buildProvider({
      getBlockNumber: jest.fn().mockResolvedValue(50_000),
      getLogs: jest
        .fn()
        .mockRejectedValueOnce(new Error('transient error'))
        .mockResolvedValue([]),
    });

    await fetchSmartAccountUserOpTransactions(
      provider as any,
      {
        address: SMART_ACCOUNT,
        id: 0,
        smartAccountUserOpScanByChainId: { [CHAIN_ID]: 49_000 },
      },
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(provider.getLogs).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
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
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(transactions).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();

    // Once the details load on a later poll, the cursor advances again.
    const retryProvider = buildProvider();
    await fetchSmartAccountUserOpTransactions(
      retryProvider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
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
      ACCOUNT_TYPE,
      CHAIN_ID
    );

    expect(provider.getLogs.mock.calls.length).toBeLessThanOrEqual(11);
    expect(transactions).toHaveLength(1);
    expect((transactions[0] as any).confirmations).toBe(95);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

describe('smart account canonical overlap and adaptive ranges', () => {
  const cachedRow = () => ({
    ...rawOuterTransaction,
    blockNumber: 99,
    confirmations: 1,
    isError: '0',
    // eslint-disable-next-line camelcase
    txreceipt_status: '1',
    smartAccountExecutionFrom: SMART_ACCOUNT,
  });
  beforeEach(() => {
    dispatchMock.mockClear();
    vaultState = {
      accountTransactions: {
        SmartAccount: { 0: { ethereum: { [CHAIN_ID]: [cachedRow()] } } },
      },
      accounts: {
        SmartAccount: {
          0: {
            id: 0,
            address: SMART_ACCOUNT,
            smartAccountUserOpScanByChainId: { [CHAIN_ID]: 100 },
          },
        },
      },
    };
  });

  it.each(['changed', 'same', 'unavailable'] as const)(
    'reconciles a disappeared overlap event using %s canonical evidence',
    async (evidence) => {
      const provider = buildProvider({
        getBlockNumber: jest.fn(async () => 102),
        getLogs: jest.fn(async () => []),
        send: jest.fn(async (method, params) => {
          expect(method).toBe('eth_getBlockByNumber');
          expect(params).toEqual(['0x63', false]);
          if (evidence === 'unavailable') throw Error('offline');
          return {
            number: '0x63',
            hash: evidence === 'same' ? BLOCK_HASH : `0x${'ee'.repeat(32)}`,
          };
        }),
      });
      const result = await fetchSmartAccountUserOpTransactions(
        provider as any,
        vaultState.accounts.SmartAccount[0],
        ACCOUNT_TYPE,
        CHAIN_ID
      );
      expect(result).toHaveLength(1);
      expect(result[0].hash).toBe(TX_HASH);
      if (evidence === 'changed') {
        expect(result[0]).toMatchObject({
          blockNumber: null,
          blockHash: null,
          confirmations: 0,
          status: 'pending',
          isError: null,
          // eslint-disable-next-line camelcase
          txreceipt_status: null,
        });
      } else
        expect(result[0]).toMatchObject({
          blockNumber: 99,
          blockHash: BLOCK_HASH,
          confirmations: 3,
        });
      if (evidence === 'unavailable')
        expect(dispatchMock).not.toHaveBeenCalled();
      else expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(102));
    }
  );

  it('does not reconcile cached rows outside a successfully covered overlap', async () => {
    const provider = buildProvider({
      getBlockNumber: jest.fn(async () => 102),
      getLogs: jest.fn(async () => {
        throw Error('rate limit');
      }),
    });
    const result = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(result[0].blockHash).toBe(BLOCK_HASH);
    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(provider.getLogs).toHaveBeenCalledTimes(1);
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('keeps cached rows beyond contiguous coverage after a later chunk fails', async () => {
    vaultState.accountTransactions.SmartAccount[0].ethereum[
      CHAIN_ID
    ][0].blockNumber = 15000;
    vaultState.accounts.SmartAccount[0].smartAccountUserOpScanByChainId[
      CHAIN_ID
    ] = 100;
    const provider = buildProvider({
      getBlockNumber: jest.fn(async () => 30000),
      getLogs: jest.fn(async (filter) => {
        if (filter.fromBlock === 95 && filter.toBlock === 30000)
          throw Error('block range too large');
        if (filter.fromBlock > 95) throw Error('offline');
        return [];
      }),
    });
    const result = await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(result[0]).toMatchObject({
      blockNumber: 15000,
      blockHash: BLOCK_HASH,
    });
    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(provider.getLogs).toHaveBeenCalledTimes(3);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(10094));
  });

  it('adapts below a 5000-block range and reuses only that endpoint capability', async () => {
    vaultState.accountTransactions.SmartAccount[0].ethereum[CHAIN_ID] = [];
    const account = vaultState.accounts.SmartAccount[0];
    account.smartAccountUserOpScanByChainId = {};
    const getLogs = jest.fn(async (filter) => {
      if (filter.toBlock - filter.fromBlock + 1 > 5000)
        throw Object.assign(Error('block range exceeds limit'), {
          code: -32005,
        });
      return filter.fromBlock <= 9999 && filter.toBlock >= 9999
        ? [{ ...buildUserOpEventLog(true), blockNumber: 9999 }]
        : [];
    });
    const provider = buildProvider({
      getBlockNumber: jest.fn(async () => 20000),
      getLogs,
      _getConnection: () => ({ url: 'https://range.example/rpc' }),
      send: jest.fn(async (method) =>
        method === 'eth_getTransactionByHash'
          ? { ...rawOuterTransaction, blockNumber: '0x270f' }
          : { number: '0x270f', hash: BLOCK_HASH, timestamp: '0x60' }
      ),
    });
    const result = await fetchSmartAccountUserOpTransactions(
      provider as any,
      account,
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(result.map((tx) => tx.hash)).toEqual([TX_HASH]);
    expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(20000));
    expect(getLogs.mock.calls.length).toBeLessThanOrEqual(11);
    getLogs.mockClear();
    await fetchSmartAccountUserOpTransactions(
      provider as any,
      account,
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(
      getLogs.mock.calls.every(
        ([filter]) => filter.toBlock - filter.fromBlock + 1 <= 5000
      )
    ).toBe(true);
    getLogs.mockClear();
    await fetchSmartAccountUserOpTransactions(
      {
        ...provider,
        _getConnection: () => ({ url: 'https://other-range.example/rpc' }),
      } as any,
      account,
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(getLogs.mock.calls[0][0]).toMatchObject({
      fromBlock: 0,
      toBlock: 20000,
    });
    const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    try {
      getLogs.mockClear();
      await fetchSmartAccountUserOpTransactions(
        provider as any,
        account,
        ACCOUNT_TYPE,
        CHAIN_ID
      );
      expect(getLogs.mock.calls[0][0]).toMatchObject({
        fromBlock: 0,
        toBlock: 20000,
      });
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    Object.assign(Error('rate limit exceeded'), { code: -32005 }),
    Object.assign(Error('unauthorized block range'), { status: 401 }),
    Object.assign(Error('cancelled block range'), { name: 'AbortError' }),
  ])('does not split non-range failures %s', async (error) => {
    const provider = buildProvider({
      getLogs: jest.fn(async () => {
        throw error;
      }),
    });
    await fetchSmartAccountUserOpTransactions(
      provider as any,
      vaultState.accounts.SmartAccount[0],
      ACCOUNT_TYPE,
      CHAIN_ID
    );
    expect(provider.getLogs).toHaveBeenCalledTimes(1);
    expect(
      provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
    ).toHaveLength(0);
    expect(dispatchMock).not.toHaveBeenCalled();
  });
});

it('retains healthy history details when one settled transaction read fails without retrying the batch', async () => {
  dispatchMock.mockClear();
  const otherHash = `0x${'ef'.repeat(32)}`;
  const account = {
    address: SMART_ACCOUNT,
    id: 0,
    smartAccountUserOpScanByChainId: {},
  };
  vaultState = {
    accountTransactions: {
      SmartAccount: { 0: { ethereum: { [CHAIN_ID]: [] } } },
    },
    accounts: { SmartAccount: { 0: account } },
    activeAccount: { id: 0, type: ACCOUNT_TYPE },
  };
  let detailsAvailable = false;
  const readMany = jest.fn(async (requests) =>
    requests.map(({ method, params }) => {
      if (method === 'eth_blockNumber')
        return { status: 'fulfilled', value: '0x64' };
      if (method === 'eth_getBlockByNumber')
        return {
          status: 'fulfilled',
          value: { number: '0x5', hash: BLOCK_HASH, timestamp: '0x60' },
        };
      if (method === 'eth_getLogs')
        return {
          status: 'fulfilled',
          value: [
            buildUserOpEventLog(true),
            { ...buildUserOpEventLog(true), transactionHash: otherHash },
          ],
        };
      if (params[0] === otherHash && !detailsAvailable)
        return { status: 'rejected', reason: Error('detail unavailable') };
      return {
        status: 'fulfilled',
        value: { ...rawOuterTransaction, hash: params[0] },
      };
    })
  );
  const provider = buildProvider({
    getLogs: jest.fn(async () => [
      buildUserOpEventLog(true),
      { ...buildUserOpEventLog(true), transactionHash: otherHash },
    ]),
    readMany,
  });
  const transactions = await fetchSmartAccountUserOpTransactions(
    provider as any,
    account,
    ACCOUNT_TYPE,
    CHAIN_ID
  );
  expect(transactions.map((tx) => tx.hash)).toEqual([TX_HASH]);
  expect(readMany).toHaveBeenCalledTimes(4);
  expect(readMany.mock.calls[2][0]).toEqual([
    { method: 'eth_getTransactionByHash', params: [TX_HASH] },
    { method: 'eth_getTransactionByHash', params: [otherHash] },
  ]);
  expect(
    provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
  ).toHaveLength(0);
  expect(dispatchMock).not.toHaveBeenCalled();
  detailsAvailable = true;
  const retried = await fetchSmartAccountUserOpTransactions(
    provider as any,
    account,
    ACCOUNT_TYPE,
    CHAIN_ID
  );
  expect(retried.map((tx) => tx.hash)).toEqual([TX_HASH, otherHash]);
  expect(dispatchMock).toHaveBeenCalledWith(expectCursorDispatch(100));
  expect(
    provider.send.mock.calls.filter(([method]) => method !== 'eth_chainId')
  ).toHaveLength(0);
});
