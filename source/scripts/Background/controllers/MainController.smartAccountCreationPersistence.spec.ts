jest.unmock('syscoinjs-lib');
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));

import { KeyringManager } from '@sidhujag/sysweb3-keyring';
import { webcrypto } from 'crypto';
import {
  AbiCoder,
  concat,
  getCreate2Address,
  Interface,
  keccak256,
  ZeroAddress,
} from 'ethers';
import http from 'http';
import https from 'https';

import { createTestKeyringManager } from '../../../../tests/fixtures/extensionKeyring';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  createAccount,
  restoreVaultSnapshot,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { EVM_TRANSACTION_CONTEXT_CHANGED } from 'utils/evmTransactionContext';
import {
  getPaliSmartAccountFactoryAddress,
  paliSmartAccountFactoryInterface,
} from 'utils/smartAccount';
import {
  PALI_ACCOUNT_PROXY_CREATION_CODE,
  PALI_INFRASTRUCTURE_METADATA_BY_ID,
} from 'utils/smartAccount/deploymentMetadata';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const FAILURE = 'Synthetic smart account storage refusal';
const originalChrome = global.chrome;
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
let wallet: any;
let manager: KeyringManager;
let records: Record<string, any>;
let refuseNextCommit: boolean;
let factorySalts: string[];
let factoryReads: string[];
let holdRead: ((name: string) => Promise<void>) | undefined;
let infrastructureReads: string[];
let rpcChainId: number;
let substituteFactoryRead: 'getAddress' | 'getInitData' | undefined;
let commits: number;
const projection = (vault: any) => ({
  active: vault.activeAccount,
  accounts: Object.values(vault.accounts.SmartAccount).map((account: any) => ({
    id: account.id,
    address: account.address,
    label: account.label,
    accountIndex: account.smartAccount.descriptor.accountIndex,
  })),
});

beforeEach(async () => {
  jest.useFakeTimers();
  Object.defineProperty(globalThis, 'crypto', {
    ...originalCrypto,
    value: webcrypto,
  });
  const deny = () => {
    throw new Error('Smart creation must remain offline');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(http, 'get').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
  jest.spyOn(https, 'get').mockImplementation(deny);
  jest.spyOn(globalThis, 'fetch').mockImplementation(deny);
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: '0x0000000000000000000000000000000000000001',
    xpub: 'public-anchor',
    label: 'Anchor',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      activeNetwork: {
        kind: INetworkType.Ethereum,
        slip44: 60,
        chainId: 1,
        url: 'https://smart-create.synthetic.invalid',
        currency: 'eth',
        label: 'Synthetic EVM',
      },
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  records = {};
  refuseNextCommit = false;
  factorySalts = [];
  factoryReads = [];
  infrastructureReads = [];
  rpcChainId = 1;
  substituteFactoryRead = undefined;
  holdRead = undefined;
  commits = 0;
  global.chrome = {
    runtime: { id: 'synthetic-smart-create' },
    storage: {
      local: {
        get: (keys: string[], callback: (result: any) => void) => {
          const respond = () =>
            callback(
              Object.fromEntries(
                keys
                  .filter((key) => key in records)
                  .map((key) => [key, structuredClone(records[key])])
              )
            );
          if (
            keys.some((key) => key.startsWith('pali.infrastructure.pending.'))
          ) {
            infrastructureReads.push('journal');
            if (holdRead) {
              void holdRead('journal').then(respond);
              return;
            }
          }
          respond();
        },
        set: (items: Record<string, any>, callback: () => void) => {
          if (items['state-vault-60']) commits += 1;
          if (items['state-vault-60'] && refuseNextCommit) {
            refuseNextCommit = false;
            (chrome.runtime as any).lastError = { message: FAILURE };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, structuredClone(items));
          callback();
        },
      },
    },
  } as any;
  await persistCommittedWalletState(true);
  commits = 0;
  manager = createTestKeyringManager();
  manager.setVaultStateGetter(() => store.getState().vault as any);
  await manager.initializeSession(
    'test test test test test test test test test test test junk',
    'synthetic-smart-creation-password'
  );
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.networkRequestGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.getActiveKeyring = () => manager;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.refreshActiveAccountLightweight = jest.fn();
  const abi = AbiCoder.defaultAbiCoder();
  const initializer = new Interface([
    'function initializeAccount(bytes initCode)',
  ]);
  // Only public read IO is synthetic. The real factory adapter encodes these
  // calls, the real controller derives each descriptor and the installed SDK
  // allocates the account ID. No signing or broadcasting is exposed.
  const provider = {
    getNetwork: async () => ({ chainId: BigInt(1) }),
    verifyConfiguredChainId: async (fresh: boolean) => {
      expect(fresh).toBe(true);
      infrastructureReads.push('chain');
      if (rpcChainId !== 1) throw new Error('Wrong RPC chain');
    },
    sendBatch: async (_method: string, params: unknown[]) => {
      infrastructureReads.push('batch');
      if (holdRead) await holdRead('infrastructure');
      return params.map(() => `0x${'11'.repeat(256)}`);
    },
    getCode: async () => {
      infrastructureReads.push('fallback');
      return '0x11';
    },
    call: async (transaction: { data: string; to: string }) => {
      const call = paliSmartAccountFactoryInterface.parseTransaction({
        data: transaction.data,
      });
      factoryReads.push(call.name);
      if (holdRead) await holdRead(call.name);
      if (call.name === 'getInitData') {
        const module = 'tuple(address module,bytes data)';
        return paliSmartAccountFactoryInterface.encodeFunctionResult(
          call.fragment,
          [
            substituteFactoryRead === 'getInitData'
              ? '0x1234'
              : abi.encode(
                  [`${module}[]`, `${module}[]`, module, `${module}[]`],
                  [[[call.args[0], call.args[1]]], [], [ZeroAddress, '0x'], []]
                ),
          ]
        );
      }
      if (call.name === 'getAddress') {
        factorySalts.push(call.args[0]);
        return paliSmartAccountFactoryInterface.encodeFunctionResult(
          call.fragment,
          [
            substituteFactoryRead === 'getAddress'
              ? '0x2222222222222222222222222222222222222222'
              : getCreate2Address(
                  transaction.to,
                  call.args[0],
                  keccak256(
                    concat([
                      PALI_ACCOUNT_PROXY_CREATION_CODE,
                      abi.encode(
                        ['address', 'bytes'],
                        [
                          PALI_INFRASTRUCTURE_METADATA_BY_ID
                            .accountImplementation.address,
                          initializer.encodeFunctionData('initializeAccount', [
                            call.args[1],
                          ]),
                        ]
                      ),
                    ])
                  )
                ),
          ]
        );
      }
      throw new Error('Unexpected synthetic factory read');
    },
  };
  const transaction = { web3Provider: provider };
  wallet.smartAccount = new SmartAccountController({
    captureSmartAccountPendingRecords: async () => ({
      profileId: '0x' + '11'.repeat(32),
      read: async () => [],
    }),
    getEthereumTransaction: () => transaction,
    getWalletSessionGeneration: () => wallet.walletSessionGeneration,
  } as any);
});

afterEach(async () => {
  await manager.destroy();
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
  Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

const holdCommit = () => {
  const original = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let captured = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (items['state-vault-60'] && !captured) {
        captured = true;
        const snapshot = structuredClone(items);
        release = () => original(snapshot, callback);
        entered();
      } else original(items, callback);
    });
  return { started, release: () => release() };
};

const nextQueuedCreation = () => {
  const storeCreatedAccount = wallet.storeCreatedAccount.bind(wallet);
  return new Promise<void>((resolve) => {
    jest.spyOn(wallet, 'storeCreatedAccount').mockImplementation((...args) => {
      const result = storeCreatedAccount(...args);
      resolve();
      return result;
    });
  });
};

it('persists the ordinary derived smart account with the SDK-allocated ID and descriptor', async () => {
  const account = await wallet.createSmartAccount({ label: 'Smart savings' });
  expect(account.id).toBe(0);
  expect(account.smartAccount.descriptor.accountIndex).toBe(0);
  expect(account.smartAccount.deploymentAuth).toEqual({
    data: account.smartAccount.auth.data,
    validator: account.smartAccount.auth.validator,
  });
  expect(account.smartAccount.factoryAddress).toBe(
    getPaliSmartAccountFactoryAddress(1)
  );
  expect(factorySalts).toEqual([account.smartAccount.deploymentSalt]);
  expect(factoryReads).toEqual(['getInitData', 'getAddress']);
  expect(infrastructureReads).toEqual(['chain', 'journal', 'journal', 'batch']);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[0].smartAccount
  ).toEqual(account.smartAccount);
});

it.each(['getInitData', 'getAddress'] as const)(
  'rejects substituted %s before persisting or selecting a smart account',
  async (response) => {
    substituteFactoryRead = response;
    await expect(
      wallet.createSmartAccount({ label: 'Safe account' })
    ).rejects.toThrow();
    expect(factoryReads).toContain(response);
    expect(commits).toBe(0);
    expect(store.getState().vault.activeAccount.type).toBe(
      KeyringAccountType.HDAccount
    );
    expect((await loadSlip44State(60)).accounts.SmartAccount).toEqual({});
  }
);

it('rejects caller-supplied smart account addresses before using the RPC', async () => {
  await expect(
    wallet.createSmartAccount({
      address: '0x2222222222222222222222222222222222222222',
      metadata: {},
    })
  ).rejects.toThrow(
    'Smart account creation does not accept an address or metadata'
  );
  expect(factoryReads).toEqual([]);
  expect(commits).toBe(0);
});

it.each([
  ['infrastructure', 'chain'],
  ['getInitData', 'account'],
  ['getInitData', 'network request'],
] as const)(
  'stops factory reads after a held %s read retires the %s scope',
  async (read, change) => {
    const original = store.getState().vault;
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    holdRead = async (name) => {
      if (name !== read) return;
      entered();
      await held;
    };
    const creation = wallet.createSmartAccount({
      label: 'Retired smart account',
    });
    const rejected = expect(creation).rejects.toThrow('Wallet session changed');
    await started;
    // Mirror the production generation invalidation at switchActiveKeyring and
    // setAccount. Both visits can have the same final chain and account tuple.
    if (change === 'chain') {
      wallet.walletSessionGeneration += 1;
      wallet.networkRequestGeneration += 1;
      store.dispatch(
        setNetworkChange({
          activeNetwork: {
            ...original.activeNetwork,
            chainId: 5700,
            url: 'https://other-smart.synthetic.invalid',
          },
        })
      );
      wallet.walletSessionGeneration += 1;
      wallet.networkRequestGeneration += 1;
      store.dispatch(
        setNetworkChange({ activeNetwork: original.activeNetwork })
      );
    } else if (change === 'account') {
      wallet.walletSessionGeneration += 1;
      store.dispatch(
        createAccount({
          accountType: KeyringAccountType.HDAccount,
          account: {
            ...original.accounts.HDAccount[0],
            id: 1,
            address: '0x0000000000000000000000000000000000000002',
          },
        })
      );
      store.dispatch(
        setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
      );
      wallet.walletSessionGeneration += 1;
      store.dispatch(setActiveAccount(original.activeAccount));
    } else {
      // Network requests retire the previous operation before the switch mutex.
      wallet.networkRequestGeneration += 1;
    }
    release();
    await rejected;
    expect(commits).toBe(0);
    expect(projection(store.getState().vault)).toEqual(projection(original));
    expect(factoryReads).toEqual(
      read === 'infrastructure' ? [] : ['getInitData']
    );
  }
);

it('refuses smart account creation while the captured keyring is locked', async () => {
  await manager.lockWallet();
  const reads = jest.fn();
  holdRead = reads;
  await expect(
    wallet.createSmartAccount({ label: 'Locked smart account' })
  ).rejects.toThrow('Wallet session changed');
  expect(reads).not.toHaveBeenCalled();
  expect(commits).toBe(0);
});

it('does not read factory or infrastructure on the wrong live chain', async () => {
  rpcChainId = 8453;
  await expect(
    wallet.createSmartAccount({ label: 'Wrong chain' })
  ).rejects.toThrow('Wrong RPC chain');
  expect(infrastructureReads).toEqual(['chain']);
  expect(factoryReads).toEqual([]);
  expect(commits).toBe(0);
});

it.each(['journal', 'infrastructure'] as const)(
  'retains no old result or subsequent probe after a held %s retires',
  async (probe) => {
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    holdRead = async (name) => {
      if (name !== probe) return;
      entered();
      await held;
      if (probe === 'infrastructure')
        throw new Error('Synthetic batch refusal');
    };
    const creation = wallet.createSmartAccount({ label: 'Retired readiness' });
    const rejected = expect(creation).rejects.toThrow('Wallet session changed');
    await started;
    wallet.networkRequestGeneration += 1;
    release();
    await rejected;
    expect(infrastructureReads).toEqual(
      probe === 'journal'
        ? ['chain', 'journal']
        : ['chain', 'journal', 'journal', 'batch']
    );
    expect(factoryReads).toEqual([]);
    expect(commits).toBe(0);
  }
);

it('keeps a refused ordinary smart creation unpublished so same-form retry preserves index zero', async () => {
  const before = projection(store.getState().vault);
  refuseNextCommit = true;
  await expect(
    wallet.createSmartAccount({ label: 'Smart savings' })
  ).rejects.toMatchObject({ message: FAILURE });
  const afterRefusal = {
    live: projection(store.getState().vault),
    cold: projection(await loadSlip44State(60)),
  };
  // Both CreateAccount and PrepareSmartAccount retry this same public method
  // after a rejected reply; neither records a returned account on failure.
  const retry = await wallet.createSmartAccount({ label: 'Smart savings' });
  expect({
    afterRefusal,
    retry: {
      id: retry.id,
      accountIndex: retry.smartAccount.descriptor.accountIndex,
    },
    sameSalt: factorySalts[0] === factorySalts[1],
  }).toEqual({
    afterRefusal: { live: before, cold: before },
    retry: { id: 0, accountIndex: 0 },
    sameSalt: true,
  });
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
  expect(projection(store.getState().vault).accounts).toHaveLength(1);
});

it('does not expose an explicit creation bypass even for a correctly derived address', async () => {
  const { assertCurrent } = wallet.accountMutationContext();
  const derived = await wallet.smartAccount
    .captureSmartAccountBootstrap(assertCurrent)
    .deriveAccount(0);
  const params = { ...derived, label: 'Explicit smart record' };
  const before = projection(store.getState().vault);
  await expect(wallet.createSmartAccount(params)).rejects.toThrow(
    'Smart account creation does not accept an address or metadata'
  );
  expect(commits).toBe(0);
  expect(projection(store.getState().vault)).toEqual(before);
  expect(projection(await loadSlip44State(60))).toEqual(before);
});

it('does not expose a smart record, cache entry or selection until its native write completes', async () => {
  const before = projection(store.getState().vault);
  const write = holdCommit();
  const creating = wallet.createSmartAccount({ label: 'Held smart account' });
  await write.started;
  expect(projection(store.getState().vault)).toEqual(before);
  expect(projection(await vaultCache.getSlip44Vault(60))).toEqual(before);
  expect(projection(await loadSlip44State(60))).toEqual(before);
  write.release();
  const account = await creating;
  expect(store.getState().vault.activeAccount).toEqual({
    id: account.id,
    type: KeyringAccountType.SmartAccount,
  });
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[account.id].smartAccount
  ).toEqual(account.smartAccount);
});

it.each(['account', 'chain', 'lock', 'keyring'] as const)(
  'repairs an unpublished smart record after the held-write %s scope is invalidated',
  async (change) => {
    const write = holdCommit();
    const creating = wallet.createSmartAccount({ label: 'Held smart account' });
    const rejected = expect(creating).rejects.toThrow('Wallet session changed');
    await write.started;
    if (change === 'keyring') {
      const replacement = createTestKeyringManager();
      replacement.setVaultStateGetter(() => store.getState().vault as any);
      wallet.getActiveKeyring = () => replacement;
    } else {
      // These are the session invalidations performed by setAccount,
      // switchActiveKeyring and lock; no unrelated async services are replaced.
      wallet.walletSessionGeneration += 1;
      if (change === 'account') {
        store.dispatch(
          createAccount({
            accountType: KeyringAccountType.HDAccount,
            account: {
              id: 1,
              address: '0x0000000000000000000000000000000000000002',
              xpub: 'other-public-anchor',
              label: 'Other anchor',
            } as any,
          })
        );
        store.dispatch(
          setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
        );
      } else if (change === 'chain') {
        store.dispatch(
          setNetworkChange({
            activeNetwork: {
              ...store.getState().vault.activeNetwork,
              chainId: 5700,
              url: 'https://other-smart.synthetic.invalid',
            },
          })
        );
      } else vaultCache.clearCache();
    }
    const current = projection(store.getState().vault);
    write.release();
    await rejected;
    expect(projection(store.getState().vault)).toEqual(current);
    expect(projection(await loadSlip44State(60))).toEqual(current);
    expect(store.getState().vault.accounts.SmartAccount[0]).toBeUndefined();
    expect(commits).toBe(2);
    if (change === 'chain')
      expect((await loadSlip44State(60)).activeNetwork.chainId).toBe(5700);
    if (change === 'keyring') await wallet.getActiveKeyring().destroy();
  }
);

it('does not repair an old smart record over replacement-wallet ownership', async () => {
  const write = holdCommit();
  const creating = wallet.createSmartAccount({
    label: 'Old wallet smart account',
  });
  const rejected = expect(creating).rejects.toThrow('Wallet session changed');
  await write.started;
  wallet.walletSessionGeneration += 1;
  wallet.walletStateGeneration += 1;
  vaultCache.clearCache();
  write.release();
  await rejected;
  expect(commits).toBe(1);
  expect(store.getState().vault.accounts.SmartAccount[0]).toBeUndefined();
  // The reset owner, not the old operation, commits the replacement snapshot.
  await persistCommittedWalletState(true);
  expect((await loadSlip44State(60)).accounts.SmartAccount).toEqual({});
});

it('rejects a second smart creation after the first one becomes selected', async () => {
  const write = holdCommit();
  const first = wallet.createSmartAccount({ label: 'First smart account' });
  await write.started;
  const secondQueued = nextQueuedCreation();
  const second = wallet.createSmartAccount({
    label: 'Concurrent smart account',
  });
  const rejected = expect(second).rejects.toThrow(
    EVM_TRANSACTION_CONTEXT_CHANGED
  );
  await secondQueued;
  write.release();
  const winner = await first;
  await rejected;
  expect(projection(store.getState().vault).accounts).toEqual([
    {
      id: 0,
      accountIndex: 0,
      address: winner.address,
      label: 'First smart account',
    },
  ]);
  const retry = await wallet.createSmartAccount({
    label: 'Retried smart account',
  });
  expect(retry.id).toBe(1);
  expect(retry.address).not.toBe(winner.address);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it('does not commit a queued smart record after concurrent HD creation changes the owner', async () => {
  const write = holdCommit();
  const first = wallet.createAccount('Concurrent HD account');
  await write.started;
  const secondQueued = nextQueuedCreation();
  const smart = wallet.createSmartAccount({ label: 'Retired smart account' });
  const rejected = expect(smart).rejects.toThrow(
    EVM_TRANSACTION_CONTEXT_CHANGED
  );
  await secondQueued;
  expect(factoryReads).toEqual(['getInitData', 'getAddress']);
  write.release();
  const hd = await first;
  await rejected;
  expect(wallet.walletSessionGeneration).toBe(0);
  expect(commits).toBe(1);
  const cold = await loadSlip44State(60);
  expect(cold.accounts.HDAccount[hd.id].address).toBe(hd.address);
  expect(cold.activeAccount).toEqual({
    id: hd.id,
    type: KeyringAccountType.HDAccount,
  });
  expect(cold.accounts.SmartAccount).toEqual({});
  expect(projection(store.getState().vault)).toEqual(projection(cold));
});

it('restores a refused attempt from cold storage before deriving the same first account', async () => {
  refuseNextCommit = true;
  await expect(
    wallet.createSmartAccount({ label: 'Cold retry' })
  ).rejects.toMatchObject({ message: FAILURE });
  const salt = factorySalts[0];
  vaultCache.clearCache();
  const cold = await loadSlip44State(60);
  store.dispatch(restoreVaultSnapshot(cold));
  const retry = await wallet.createSmartAccount({ label: 'Cold retry' });
  expect(retry.id).toBe(0);
  expect(retry.smartAccount.deploymentSalt).toBe(salt);
  expect(projection(await loadSlip44State(60))).toEqual(
    projection(store.getState().vault)
  );
});

it('keeps HD account zero as the default management owner when another account is selected', () => {
  store.dispatch(
    createAccount({
      account: {
        id: 3,
        address: '0x3333333333333333333333333333333333333333',
        xpub: 'another-owner',
        label: 'Another owner',
      } as any,
      accountType: KeyringAccountType.HDAccount,
    } as any)
  );
  store.dispatch(
    setActiveAccount({ id: 3, type: KeyringAccountType.HDAccount })
  );
  expect(wallet.smartAccount.getWalletManagementAddress()).toBe(
    '0x0000000000000000000000000000000000000001'
  );
});

it('preserves the active non-smart management-owner fallback when HD account zero is absent', () => {
  const vault = store.getState().vault;
  const imported = {
    id: 4,
    address: '0x4444444444444444444444444444444444444444',
    xpub: 'imported-owner',
    label: 'Imported owner',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...vault,
      accounts: { ...vault.accounts, HDAccount: {}, Imported: { 4: imported } },
      activeAccount: { id: 4, type: KeyringAccountType.Imported },
    } as any)
  );
  expect(wallet.smartAccount.getWalletManagementAddress()).toBe(
    imported.address
  );
});
