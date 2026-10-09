jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: jest.fn(), dispatch: jest.fn() },
}));
jest.mock('utils/security/blacklistService', () => ({ blacklistService: {} }));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('utils/smartAccount', () => ({
  ...jest.requireActual('utils/smartAccount'),
  getPaliInfrastructureContracts: () => [
    {
      id: 'accountImplementation',
      address: '0x0000000000000000000000000000000000000001',
      displayName: 'Implementation',
      deployCalldata: '0x01',
    },
    {
      id: 'factory',
      address: '0x0000000000000000000000000000000000000002',
      displayName: 'Factory',
      deployCalldata: '0x02',
    },
  ],
}));

import store from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { PALI_CREATE2_DEPLOYER_ADDRESS } from 'utils/smartAccount';
import { chromeStorage } from 'utils/storageAPI';

import SmartAccountController from './index';

const implementation = '0x0000000000000000000000000000000000000001';
const factory = '0x0000000000000000000000000000000000000002';
const hash = (number: number) => `0x${number.toString(16).padStart(64, '0')}`;
const flush = async () => {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
};

describe('smart-account infrastructure deployment lifecycle', () => {
  let state: any;
  let controller: any;
  let provider: any;
  let transaction: any;
  let deps: any;
  let codes: Record<string, string>;
  let receipts: Record<string, any>;
  let generation: number;
  let journalStorage: Record<string, any>;

  beforeEach(() => {
    jest.useFakeTimers();
    generation = 0;
    journalStorage = {};
    (chromeStorage.getItem as jest.Mock).mockImplementation(
      async (key) => journalStorage[key] ?? null
    );
    (chromeStorage.setItem as jest.Mock).mockImplementation(
      async (key, value) => {
        journalStorage[key] = value;
      }
    );
    codes = {
      [PALI_CREATE2_DEPLOYER_ADDRESS]: '0x11',
      [implementation]: '0x',
      [factory]: '0x',
    };
    receipts = {};
    state = {
      vaultGlobal: { activeSlip44: 60 },
      vault: {
        isBitcoinBased: false,
        activeNetwork: {
          chainId: 1,
          url: 'https://chain-a.example',
          kind: INetworkType.Ethereum,
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        accounts: {
          HDAccount: {
            0: { id: 0, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
          },
        },
        accountTransactions: { HDAccount: { 0: { ethereum: { 1: [] } } } },
      },
    };
    (store.getState as jest.Mock).mockImplementation(() => state);
    provider = {
      sendBatch: jest.fn(async (_method, addresses) =>
        addresses.map(([address]: [string]) => codes[address])
      ),
      getCode: jest.fn(async (address) => codes[address]),
      send: jest.fn(async (method, params) =>
        method === 'eth_getTransactionCount' ? '0x0' : codes[params[0]]
      ),
      getTransactionReceipt: jest.fn(
        async (txHash) => receipts[txHash] || null
      ),
    };
    transaction = { web3Provider: provider };
    deps = {
      getEthereumTransaction: () => transaction,
      getWalletSessionGeneration: () => generation,
      sendAndSaveEthTransaction: jest.fn(
        async (params, _legacy, _account, metadata, options) => {
          options.assertCurrentContext();
          const txHash = hash(deps.sendAndSaveEthTransaction.mock.calls.length);
          const contractAddress =
            params.data === '0x01' ? implementation : factory;
          codes[contractAddress] = '0x11';
          receipts[txHash] = { status: 1, hash: txHash };
          const response = {
            hash: txHash,
            wait: jest.fn(() => {
              throw Error('Unbounded wait must not be called');
            }),
          };
          await options.onBroadcast?.(response);
          state.vault.accountTransactions.HDAccount[0].ethereum[1].unshift({
            ...metadata,
            hash: txHash,
            confirmations: 0,
          });
          return response;
        }
      ),
    };
    controller = new SmartAccountController(deps);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('uses explicit monotonically advancing nonces even when raw pending count remains stale', async () => {
    await expect(
      controller.deploySmartAccountInfrastructure()
    ).resolves.toEqual({
      deployed: ['accountImplementation', 'factory'],
      skipped: [],
    });
    expect(
      deps.sendAndSaveEthTransaction.mock.calls.map(([params]) => params.nonce)
    ).toEqual([0, 1]);
    expect(deps.sendAndSaveEthTransaction.mock.calls[0][0]).toMatchObject({
      chainId: 1,
      from: state.vault.accounts.HDAccount[0].address,
    });
  });

  it('shares one deployment flight across concurrent callers', async () => {
    const first = controller.deploySmartAccountInfrastructure();
    const second = controller.deploySmartAccountInfrastructure();
    expect(first).toBe(second);
    await first;
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(2);
  });

  it('expires cached status and separates RPC endpoints on the same chain', async () => {
    expect(
      (await controller.getSmartAccountInfrastructureStatus()).missing
    ).toHaveLength(2);
    codes[implementation] = '0x11';
    expect(
      (await controller.getSmartAccountInfrastructureStatus()).missing
    ).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(5001);
    expect(
      (await controller.getSmartAccountInfrastructureStatus()).missing
    ).toEqual(['factory']);
    codes[factory] = '0x11';
    state.vault.activeNetwork.url = 'https://other-rpc.example';
    expect((await controller.getSmartAccountInfrastructureStatus()).ready).toBe(
      true
    );
  });

  it('rejects malformed code probes instead of treating them as missing deployments', async () => {
    provider.sendBatch.mockResolvedValue([null]);
    provider.getCode.mockResolvedValue(undefined);
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Invalid infrastructure code response'
    );
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('rechecks code before every send so another deployer can finish missing contracts', async () => {
    provider.send.mockImplementation(async (method) =>
      method === 'eth_getCode' ? '0x11' : '0x0'
    );
    await expect(
      controller.deploySmartAccountInfrastructure()
    ).resolves.toEqual({
      deployed: [],
      skipped: ['accountImplementation', 'factory'],
    });
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('invalidates cached missing count after partial failure', async () => {
    deps.sendAndSaveEthTransaction
      .mockImplementationOnce(async () => {
        codes[implementation] = '0x11';
        receipts[hash(1)] = { status: 1, hash: hash(1) };
        return { hash: hash(1) };
      })
      .mockRejectedValueOnce(Error('nonce too low'));
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'nonce too low'
    );
    expect(
      (await controller.getSmartAccountInfrastructureStatus()).missing
    ).toEqual(['factory']);
  });

  it('returns a bounded pending hash and recovers it across controller restart without resending', async () => {
    deps.sendAndSaveEthTransaction.mockImplementation(
      async (_params, _legacy, _account, metadata, options) => {
        const response = { hash: hash(1) };
        await options.onBroadcast?.(response);
        state.vault.accountTransactions.HDAccount[0].ethereum[1].unshift({
          ...metadata,
          hash: hash(1),
          confirmations: 0,
        });
        return response;
      }
    );
    const deployment = controller.deploySmartAccountInfrastructure();
    await flush();
    await jest.advanceTimersByTimeAsync(16000);
    await expect(deployment).resolves.toMatchObject({
      pending: {
        contractId: 'accountImplementation',
        transactionHash: hash(1),
      },
    });
    state.vault.activeAccount = { id: 7, type: KeyringAccountType.Imported };
    state.vault.accounts.Imported = {
      7: { id: 7, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    };
    const restarted = new SmartAccountController(deps);
    await expect(
      restarted.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({ pending: { transactionHash: hash(1) } });
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  });

  it('stops unsigned remaining contracts when the session changes during confirmation', async () => {
    deps.sendAndSaveEthTransaction.mockImplementationOnce(async () => {
      codes[implementation] = '0x11';
      receipts[hash(1)] = { status: 1, hash: hash(1) };
      generation += 1;
      return { hash: hash(1) };
    });
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Wallet context changed'
    );
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  });

  it('recovers a journaled broadcast after restart even when no current-vault history was saved', async () => {
    (chromeStorage.getItem as jest.Mock).mockResolvedValue({
      contractId: 'accountImplementation',
      transactionHash: hash(9),
    });
    await expect(
      controller.getSmartAccountInfrastructureStatus(true)
    ).resolves.toMatchObject({
      pending: {
        contractId: 'accountImplementation',
        transactionHash: hash(9),
      },
    });
    await expect(
      controller.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      pending: { transactionHash: hash(9) },
    });
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });
  it.each([
    'insufficient funds',
    'user rejected transaction',
    'Wallet context changed',
  ])('releases a definitely rejected reservation: %s', async (message) => {
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(Error(message));
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      message
    );
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
    expect(
      (await controller.getSmartAccountInfrastructureStatus(true)).pending
    ).toBeUndefined();
    await expect(
      controller.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      deployed: ['accountImplementation', 'factory'],
    });
  });

  it.each([KeyringAccountType.Trezor, KeyringAccountType.Ledger])(
    'releases a rejected %s signature and permits retry after worker restart',
    async (type) => {
      state.vault.activeAccount = { id: 3, type };
      state.vault.accounts[type] = {
        3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
      };
      const rejection = 'Transaction Signature Failed. Error: [object Object]';
      deps.sendAndSaveEthTransaction.mockImplementationOnce(async () => {
        expect(
          journalStorage['pali.infrastructure.pending.v1.1']
        ).toMatchObject({
          contractId: 'accountImplementation',
        });
        expect(
          journalStorage['pali.infrastructure.pending.v1.1'].transactionHash
        ).toBeUndefined();
        expect(
          journalStorage['pali.infrastructure.pending.v1.1'].nonce
        ).toBeUndefined();
        throw Error(rejection);
      });
      await expect(
        controller.deploySmartAccountInfrastructure()
      ).rejects.toThrow(rejection);
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
      expect(
        (await controller.getSmartAccountInfrastructureStatus(true)).pending
      ).toBeUndefined();
      const restarted = new SmartAccountController(deps);
      await expect(
        restarted.deploySmartAccountInfrastructure()
      ).resolves.toMatchObject({
        deployed: ['accountImplementation', 'factory'],
      });
      expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(3);
      expect(deps.sendAndSaveEthTransaction.mock.calls[1][2]).toEqual({
        id: 3,
        type,
      });
    }
  );

  it('does not classify the hardware signing error as a local-account rejection', async () => {
    const rejection = 'Transaction Signature Failed. Error: [object Object]';
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(Error(rejection));
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      rejection
    );
    const restarted = new SmartAccountController(deps);
    await expect(
      restarted.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      pending: { contractId: 'accountImplementation' },
    });
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  });

  it('persists an unknown reservation before submission and blocks blind resend after worker restart', async () => {
    deps.sendAndSaveEthTransaction.mockImplementationOnce(async () => {
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toMatchObject({
        contractId: 'accountImplementation',
        nonce: 0,
      });
      expect(
        journalStorage['pali.infrastructure.pending.v1.1'].attemptId
      ).toMatch(/^0x[0-9a-f]{64}$/);
      throw Error('Network request timed out');
    });
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Network request timed out'
    );
    const restarted = new SmartAccountController(deps);
    await expect(
      restarted.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      pending: { contractId: 'accountImplementation' },
    });
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
    codes[implementation] = '0x11';
    await expect(restarted.deploySmartAccountInfrastructure()).resolves.toEqual(
      { deployed: ['factory'], skipped: ['accountImplementation'] }
    );
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(2);
  });

  it('retains the pre-send reservation when acknowledged hash persistence fails', async () => {
    const storageWrite = (
      chromeStorage.setItem as jest.Mock
    ).getMockImplementation();
    (chromeStorage.setItem as jest.Mock).mockImplementation(
      async (key, value) => {
        if (value?.transactionHash) throw Error('disk unavailable');
        return storageWrite(key, value);
      }
    );
    deps.sendAndSaveEthTransaction.mockImplementationOnce(
      async (_params, _legacy, _account, _metadata, options) => {
        try {
          await options.onBroadcast({ hash: hash(1), nonce: 0 });
        } catch (error) {
          throw Object.assign(error, { transactionHash: hash(1) });
        }
      }
    );
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'disk unavailable'
    );
    expect(
      journalStorage['pali.infrastructure.pending.v1.1'].transactionHash
    ).toBeUndefined();
    const restarted = new SmartAccountController(deps);
    await expect(
      restarted.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      pending: { contractId: 'accountImplementation' },
    });
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([KeyringAccountType.Trezor, KeyringAccountType.Ledger])(
    'repairs an acknowledged %s journal after one hash-write failure and recovers a reverted transaction after restart',
    async (type) => {
      state.vault.activeAccount = { id: 3, type };
      state.vault.accounts[type] = {
        3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
      };
      const storageWrite = (
        chromeStorage.setItem as jest.Mock
      ).getMockImplementation();
      let failHashWrite = true;
      (chromeStorage.setItem as jest.Mock).mockImplementation(
        async (key, value) => {
          if (value?.transactionHash && failHashWrite) {
            failHashWrite = false;
            throw Error('disk temporarily unavailable');
          }
          return storageWrite(key, value);
        }
      );
      deps.sendAndSaveEthTransaction.mockImplementationOnce(
        async (_params, _legacy, _account, _metadata, options) => {
          try {
            await options.onBroadcast({ hash: hash(1), nonce: 7 });
          } catch (error) {
            throw Object.assign(error, {
              transactionHash: hash(1),
              transactionNonce: 7,
            });
          }
        }
      );
      await expect(
        controller.deploySmartAccountInfrastructure()
      ).rejects.toThrow('disk temporarily unavailable');
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toMatchObject({
        transactionHash: hash(1),
        nonce: 7,
      });
      const restarted = new SmartAccountController(deps);
      await expect(
        restarted.deploySmartAccountInfrastructure()
      ).resolves.toMatchObject({
        pending: { transactionHash: hash(1), nonce: 7 },
      });
      expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
      receipts[hash(1)] = { status: 0, hash: hash(1) };
      expect(
        (await restarted.getSmartAccountInfrastructureStatus(true)).pending
      ).toBeUndefined();
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
      await expect(
        restarted.deploySmartAccountInfrastructure()
      ).resolves.toMatchObject({
        deployed: ['accountImplementation', 'factory'],
      });
      expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(3);
    }
  );

  it('journals an acknowledged hardware nonce when submission fails before the broadcast callback', async () => {
    state.vault.activeAccount = { id: 3, type: KeyringAccountType.Trezor };
    state.vault.accounts.Trezor = {
      3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
    };
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
      Object.assign(Error('Signing context restoration failed'), {
        transactionHash: hash(1),
        transactionNonce: 7,
      })
    );
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Signing context restoration failed'
    );
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toMatchObject({
      transactionHash: hash(1),
      nonce: 7,
    });
  });

  it('continues past an old settled history record to find another account pending deployment', async () => {
    state.vault.accountTransactions.HDAccount[0].ethereum[1] = [
      {
        smartAccountInfrastructureDeployment: true,
        smartAccountInfrastructureId: 'accountImplementation',
        hash: hash(1),
      },
    ];
    state.vault.accountTransactions.Imported = {
      7: {
        ethereum: {
          1: [
            {
              smartAccountInfrastructureDeployment: true,
              smartAccountInfrastructureId: 'factory',
              hash: hash(2),
            },
          ],
        },
      },
    };
    receipts[hash(1)] = { status: 0, hash: hash(1) };
    await expect(
      controller.deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      pending: { contractId: 'factory', transactionHash: hash(2) },
    });
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'releases a nonce-consumed reservation (known hash: %s) after cancellation/replacement',
    async (knownHash) => {
      journalStorage['pali.infrastructure.pending.v1.1'] = {
        contractId: 'accountImplementation',
        attemptId: hash(99),
        transactionHash: knownHash ? hash(1) : undefined,
        payerAddress: state.vault.accounts.HDAccount[0].address,
        nonce: 3,
      };
      provider.send.mockImplementation(async (method, params) =>
        method === 'eth_getTransactionCount' ? '0x4' : codes[params[0]]
      );
      expect(
        (await controller.getSmartAccountInfrastructureStatus(true)).pending
      ).toBeUndefined();
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
      await controller.deploySmartAccountInfrastructure();
      expect(deps.sendAndSaveEthTransaction.mock.calls[0][0].nonce).toBe(4);
    }
  );

  it('keeps the acknowledged hardware nonce in memory for cancellation recovery', async () => {
    state.vault.activeAccount = { id: 3, type: KeyringAccountType.Ledger };
    state.vault.accounts.Ledger = {
      3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
    };
    deps.sendAndSaveEthTransaction.mockImplementationOnce(
      async (_params, _legacy, _account, _metadata, options) => {
        const response = { hash: hash(1), nonce: 7 };
        await options.onBroadcast(response);
        return response;
      }
    );
    const deploying = controller.deploySmartAccountInfrastructure();
    await flush();
    await jest.advanceTimersByTimeAsync(16000);
    await expect(deploying).resolves.toMatchObject({ pending: { nonce: 7 } });
    provider.send.mockImplementation(async (method, params) =>
      method === 'eth_getTransactionCount' ? '0x8' : codes[params[0]]
    );
    expect(
      (await controller.getSmartAccountInfrastructureStatus(true)).pending
    ).toBeUndefined();
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
  });

  it('does not let a delayed old receipt clear a newer attempt or its status', async () => {
    const oldPending = {
      contractId: 'accountImplementation',
      attemptId: hash(90),
      transactionHash: hash(1),
    };
    const newPending = {
      contractId: 'factory',
      attemptId: hash(91),
      transactionHash: hash(2),
    };
    journalStorage['pali.infrastructure.pending.v1.1'] = oldPending;
    controller.pendingInfrastructure.set(1, oldPending);
    let finish!: (receipt: any) => void;
    let started!: () => void;
    const readingReceipt = new Promise<void>((resolve) => {
      started = resolve;
    });
    provider.getTransactionReceipt.mockImplementationOnce(() => {
      started();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const reading = controller.getSmartAccountInfrastructureStatus(true);
    await readingReceipt;
    journalStorage['pali.infrastructure.pending.v1.1'] = newPending;
    controller.pendingInfrastructure.set(1, newPending);
    finish({ status: 1, hash: hash(1) });
    await expect(reading).resolves.toMatchObject({ pending: newPending });
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toEqual(
      newPending
    );
  });

  it('rejects a receipt for the wrong transaction without clearing the pending journal', async () => {
    const pending = {
      contractId: 'accountImplementation',
      transactionHash: hash(1),
    };
    journalStorage['pali.infrastructure.pending.v1.1'] = pending;
    receipts[hash(1)] = { status: 1, hash: hash(2) };
    await expect(
      controller.getSmartAccountInfrastructureStatus(true)
    ).rejects.toThrow('Invalid deployment receipt');
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toEqual(pending);
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it.each([null, '', true, '0x00', 'junk'])(
    'rejects malformed pending nonce %s before reserving or sending',
    async (nonce) => {
      provider.send.mockImplementation(async (method, params) =>
        method === 'eth_getTransactionCount' ? nonce : codes[params[0]]
      );
      await expect(
        controller.deploySmartAccountInfrastructure()
      ).rejects.toThrow('Invalid deployment nonce response');
      expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
      expect(
        journalStorage['pali.infrastructure.pending.v1.1']
      ).toBeUndefined();
    }
  );
  it.each(['resolve', 'reject'])(
    'clears a known-unsent reservation when its storage write settles late (%s)',
    async (settlement) => {
      state.vault.activeAccount = { id: 3, type: KeyringAccountType.Ledger };
      state.vault.accounts.Ledger = {
        3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
      };
      let settle!: () => void;
      (chromeStorage.setItem as jest.Mock).mockImplementationOnce(
        (key, value) =>
          new Promise<void>((resolve, reject) => {
            settle = () => {
              journalStorage[key] = value;
              if (settlement === 'resolve') resolve();
              else reject(Error('late write failure'));
            };
          })
      );
      const deploying = controller.deploySmartAccountInfrastructure();
      const rejected = expect(deploying).rejects.toThrow(
        'Infrastructure RPC timed out'
      );
      await flush();
      await jest.advanceTimersByTimeAsync(8001);
      await rejected;
      expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
      settle();
      await flush();
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
      const restarted = new SmartAccountController(deps);
      await expect(
        restarted.deploySmartAccountInfrastructure()
      ).resolves.toMatchObject({
        deployed: ['accountImplementation', 'factory'],
      });
    }
  );

  it('does not clear a newer attempt after an older unsent reservation write times out', async () => {
    let settle!: () => void;
    (chromeStorage.setItem as jest.Mock).mockImplementationOnce(
      (key, value) =>
        new Promise<void>((resolve) => {
          settle = () => {
            journalStorage[key] = value;
            resolve();
          };
        })
    );
    const deploying = controller.deploySmartAccountInfrastructure();
    const rejected = expect(deploying).rejects.toThrow(
      'Infrastructure RPC timed out'
    );
    await flush();
    await jest.advanceTimersByTimeAsync(8001);
    await rejected;
    settle();
    const newer = {
      contractId: 'factory',
      attemptId: hash(98),
      payerAddress: state.vault.accounts.HDAccount[0].address,
    };
    journalStorage['pali.infrastructure.pending.v1.1'] = newer;
    await flush();
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toEqual(newer);
    expect(deps.sendAndSaveEthTransaction).not.toHaveBeenCalled();
  });

  it('releases a reservation on the trusted pre-broadcast marker even for an unfamiliar error', async () => {
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
      Object.assign(Error('Fee discovery unavailable'), {
        transactionNotBroadcast: true,
      })
    );
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Fee discovery unavailable'
    );
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
    await expect(
      new SmartAccountController(deps).deploySmartAccountInfrastructure()
    ).resolves.toMatchObject({
      deployed: ['accountImplementation', 'factory'],
    });
  });

  it.each([false, true])(
    'settles only its unsent hardware attempt after a late journal clear (newer attempt: %s)',
    async (hasNewerAttempt) => {
      state.vault.activeAccount = { id: 3, type: KeyringAccountType.Ledger };
      state.vault.accounts.Ledger = {
        3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
      };
      deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
        Object.assign(Error('Definitely before broadcast'), {
          transactionNotBroadcast: true,
        })
      );
      let finishClear!: () => void;
      let delayed = false;
      (chromeStorage.setItem as jest.Mock).mockImplementation((key, value) => {
        if (value === null && !delayed) {
          delayed = true;
          return new Promise<void>((resolve) => {
            finishClear = () => {
              journalStorage[key] = null;
              resolve();
            };
          });
        }
        journalStorage[key] = value;
        return Promise.resolve();
      });
      const deploying = controller.deploySmartAccountInfrastructure();
      const rejected = expect(deploying).rejects.toThrow(
        'Infrastructure RPC timed out'
      );
      await flush();
      expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(8001);
      await rejected;
      const newer = { contractId: 'factory', attemptId: hash(98) };
      if (hasNewerAttempt) controller.pendingInfrastructure.set(1, newer);
      finishClear();
      await flush();
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toBeNull();
      const status = await controller.getSmartAccountInfrastructureStatus(true);
      if (hasNewerAttempt) {
        expect(status.pending).toEqual(newer);
      } else {
        expect(status.pending).toBeUndefined();
        await expect(
          controller.deploySmartAccountInfrastructure()
        ).resolves.toMatchObject({
          deployed: ['accountImplementation', 'factory'],
        });
      }
    }
  );

  it('retains a known-unsent attempt when its delayed journal clear fails', async () => {
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
      Object.assign(Error('Definitely before broadcast'), {
        transactionNotBroadcast: true,
      })
    );
    let rejectClear!: () => void;
    (chromeStorage.setItem as jest.Mock).mockImplementation((key, value) => {
      if (value === null)
        return new Promise<void>((_resolve, reject) => {
          rejectClear = () => reject(Error('Storage unavailable'));
        });
      journalStorage[key] = value;
      return Promise.resolve();
    });
    const deploying = controller.deploySmartAccountInfrastructure();
    const rejected = expect(deploying).rejects.toThrow(
      'Infrastructure RPC timed out'
    );
    await flush();
    await jest.advanceTimersByTimeAsync(8001);
    await rejected;
    const reservation = controller.pendingInfrastructure.get(1);
    rejectClear();
    await flush();
    expect(controller.pendingInfrastructure.get(1)).toEqual(reservation);
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toEqual(
      reservation
    );
    expect(
      (await controller.getSmartAccountInfrastructureStatus(true)).pending
    ).toEqual(reservation);
    expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
  });

  it.each([
    'Wallet context changed',
    'insufficient funds',
    'Transaction Signature Failed. Error: [object Object]',
  ])(
    'retains an explicitly ambiguous broadcast reservation despite legacy rejection text: %s',
    async (message) => {
      state.vault.activeAccount = { id: 3, type: KeyringAccountType.Ledger };
      state.vault.accounts.Ledger = {
        3: { id: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc' },
      };
      deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
        Object.assign(Error(message), { transactionNotBroadcast: false })
      );
      await expect(
        controller.deploySmartAccountInfrastructure()
      ).rejects.toThrow(message);
      expect(journalStorage['pali.infrastructure.pending.v1.1']).toMatchObject({
        contractId: 'accountImplementation',
      });
      await expect(
        new SmartAccountController(deps).deploySmartAccountInfrastructure()
      ).resolves.toMatchObject({
        pending: { contractId: 'accountImplementation' },
      });
      expect(deps.sendAndSaveEthTransaction).toHaveBeenCalledTimes(1);
    }
  );

  it('keeps an acknowledged hash pending even if a rejection incorrectly carries the pre-broadcast marker', async () => {
    deps.sendAndSaveEthTransaction.mockRejectedValueOnce(
      Object.assign(Error('Fee discovery unavailable'), {
        transactionNotBroadcast: true,
        transactionHash: hash(1),
      })
    );
    await expect(controller.deploySmartAccountInfrastructure()).rejects.toThrow(
      'Fee discovery unavailable'
    );
    expect(controller.pendingInfrastructure.get(1)).toMatchObject({
      transactionHash: hash(1),
    });
    expect(journalStorage['pali.infrastructure.pending.v1.1']).toMatchObject({
      contractId: 'accountImplementation',
    });
  });
});
