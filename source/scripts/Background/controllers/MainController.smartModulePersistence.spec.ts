jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@sidhujag/sysweb3-keyring', () => ({
  KeyringManager: jest.fn(),
  CustomJsonRpcProvider: jest.fn(),
  PsbtUtils: {},
}));

import http from 'http';
import https from 'https';

import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, {
  loadAndActivateSlip44Vault,
  persistCommittedWalletState,
} from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountBalances,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController from './MainController';
import SmartAccountController from './smartAccount';

const FAILURE = 'Synthetic custom module persistence refusal';
const ACCOUNT = '0x1111111111111111111111111111111111111111';
const MODULE = '0x2222222222222222222222222222222222222222';
const RPC = 'https://module-persistence.synthetic.invalid';
const record = {
  address: MODULE,
  name: 'Reviewed validator',
  moduleType: 1,
  initData: '0x',
};
const context = {
  account: { address: ACCOUNT, id: 0, type: KeyringAccountType.SmartAccount },
  chainId: 1,
  rpcUrl: RPC,
  sessionGeneration: 0,
  slip44: 60,
};
const initialVault = store.getState().vault;
const originalChrome = global.chrome;
let wallet: any;
let records: Record<string, any>;
let failNextVaultWrite: boolean;
let vaultWrites: number;
let transaction: any;
const modules = (vault: any) =>
  vault.accounts.SmartAccount[0].smartAccount.customModules;
const add = () =>
  wallet.addSmartAccountCustomModule({
    accountId: 0,
    expectedContext: context,
    record,
  });
const remove = () =>
  wallet.removeSmartAccountCustomModule({
    accountId: 0,
    expectedContext: context,
    address: MODULE,
  });

beforeEach(async () => {
  const deny = () => {
    throw new Error('Post-install metadata must not perform network IO');
  };
  jest.spyOn(http, 'request').mockImplementation(deny);
  jest.spyOn(https, 'request').mockImplementation(deny);
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
  accounts.HDAccount[1] = {
    id: 1,
    address: '0x7777777777777777777777777777777777777777',
    xpub: 'synthetic-public-key',
    label: 'Other account',
  };
  accounts.SmartAccount[0] = {
    id: 0,
    type: KeyringAccountType.SmartAccount,
    address: ACCOUNT,
    label: 'Synthetic smart account',
    isSmartAccount: true,
    smartAccount: { chainId: 1, customModules: [] },
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...initialVault,
      activeNetwork: {
        chainId: 1,
        slip44: 60,
        kind: INetworkType.Ethereum,
        url: RPC,
        label: 'Synthetic EVM',
        currency: 'eth',
      },
      activeAccount: { id: 0, type: KeyringAccountType.SmartAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  records = {};
  failNextVaultWrite = false;
  vaultWrites = 0;
  global.chrome = {
    runtime: {},
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, structuredClone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          if ('state-vault-60' in items) vaultWrites += 1;
          if ('state-vault-60' in items && failNextVaultWrite) {
            failNextVaultWrite = false;
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
  vaultWrites = 0;
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.resetAutoLockTimer = jest.fn();
  transaction = {
    web3Provider: {
      getCode: jest.fn().mockResolvedValue('0x'),
      sendBatch: jest.fn(async (_method, calls) => calls.map(() => '0x')),
    },
  };
  wallet.smartAccount = new SmartAccountController({
    getWalletSessionGeneration: () => wallet.walletSessionGeneration,
    getWalletStateGeneration: () => wallet.walletStateGeneration,
    getEthereumTransaction: () => transaction,
    saveWalletState: (...args: any[]) => wallet.saveWalletState(...args),
  } as any);
});

const holdWrite = () => {
  const native = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  let held = false;
  const started = new Promise<void>((resolve) => (entered = resolve));
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (!held && items['state-vault-60']) {
        held = true;
        release = () => native(items, callback);
        entered();
      } else native(items, callback);
    });
  return { started, release: () => release() };
};

afterEach(() => {
  vaultCache.clearCache();
  walletPersistenceGate.blocked = false;
  store.dispatch(restoreVaultSnapshot(initialVault));
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

it('persists the reviewed custom record before a successful metadata completion', async () => {
  await expect(add()).resolves.toMatchObject({ customModules: [record] });
  expect(modules(await loadSlip44State(60))).toEqual([record]);
  expect(vaultWrites).toBe(1);
  vaultCache.clearCache();
  await loadAndActivateSlip44Vault(60);
  expect(modules(store.getState().vault)).toEqual([record]);
});

it('persists an ordinary custom-record removal', async () => {
  await add();
  await expect(remove()).resolves.toMatchObject({ customModules: [] });
  expect(modules(await loadSlip44State(60))).toEqual([]);
  expect(vaultWrites).toBe(2);
});

it('does not acknowledge the same-record retry until the failed custom-module save is durable', async () => {
  failNextVaultWrite = true;
  await expect(add()).rejects.toMatchObject({ message: FAILURE });
  expect(modules(store.getState().vault)).toEqual([]);
  expect(modules(await vaultCache.getSlip44Vault(60))).toEqual([]);
  const beforeRetry = vaultWrites;
  await expect(add()).resolves.toMatchObject({ customModules: [record] });
  expect({
    retryWrites: vaultWrites - beforeRetry,
    live: modules(store.getState().vault),
    restored: modules(await loadSlip44State(60)),
  }).toEqual({ retryWrites: 1, live: [record], restored: [record] });
});

it('keeps a refused removal unpublished and permits the same retry', async () => {
  await add();
  failNextVaultWrite = true;
  await expect(remove()).rejects.toMatchObject({ message: FAILURE });
  expect(modules(store.getState().vault)).toEqual([record]);
  expect(modules(await loadSlip44State(60))).toEqual([record]);
  await remove();
  expect(modules(await loadSlip44State(60))).toEqual([]);
});

it('keeps held metadata unpublished and combines concurrent distinct additions', async () => {
  const held = holdWrite();
  const first = add();
  await held.started;
  expect(modules(store.getState().vault)).toEqual([]);
  expect(modules(await vaultCache.getSlip44Vault(60))).toEqual([]);
  const secondRecord = {
    ...record,
    address: '0x3333333333333333333333333333333333333333',
  };
  const second = wallet.addSmartAccountCustomModule({
    accountId: 0,
    expectedContext: context,
    record: secondRecord,
  });
  held.release();
  await first;
  await second;
  expect(modules(store.getState().vault)).toEqual([record, secondRecord]);
  expect(modules(await loadSlip44State(60))).toEqual([record, secondRecord]);
});

it('combines a queued removal with a distinct addition without resurrecting the removed module', async () => {
  await add();
  const held = holdWrite();
  const removing = remove();
  await held.started;
  const secondRecord = {
    ...record,
    address: '0x3333333333333333333333333333333333333333',
  };
  const adding = wallet.addSmartAccountCustomModule({
    accountId: 0,
    expectedContext: context,
    record: secondRecord,
  });
  held.release();
  await removing;
  await adding;
  expect(modules(await loadSlip44State(60))).toEqual([secondRecord]);
});

it('preserves a concurrently acknowledged metadata refresh and its queued save', async () => {
  const held = holdWrite();
  const adding = add();
  await held.started;
  // On-chain registration publishes its refreshed metadata, then calls the
  // ordinary sync wallet save. Exercise that same writer ordering here.
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'smartAccount',
      value: {
        ...store.getState().vault.accounts.SmartAccount[0].smartAccount,
        isDeployed: true,
      },
    })
  );
  const saving = persistCommittedWalletState(true);
  held.release();
  await adding;
  await saving;
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[0].smartAccount
  ).toMatchObject({ isDeployed: true, customModules: [record] });
});

it.each([
  'session',
  'selection',
  'chain',
  'endpoint',
  'ABA',
  'descriptor',
  'address',
])(
  'repairs a held write invalidated by %s without publishing it',
  async (axis) => {
    const held = holdWrite();
    const saving = add();
    const rejected = expect(saving).rejects.toThrow();
    await held.started;
    if (axis === 'session' || axis === 'ABA') wallet.walletSessionGeneration++;
    if (axis === 'selection')
      store.dispatch(
        setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
      );
    if (axis === 'chain' || axis === 'ABA')
      store.dispatch(
        setNetworkChange({
          activeNetwork: {
            ...store.getState().vault.activeNetwork,
            chainId: 2,
          },
        })
      );
    if (axis === 'ABA')
      store.dispatch(
        setNetworkChange({
          activeNetwork: {
            ...store.getState().vault.activeNetwork,
            chainId: 1,
          },
        })
      );
    if (axis === 'endpoint')
      store.dispatch(
        setNetworkChange({
          activeNetwork: {
            ...store.getState().vault.activeNetwork,
            url: 'https://replacement.invalid',
          },
        })
      );
    if (axis === 'descriptor' || axis === 'address')
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: 0,
          type: KeyringAccountType.SmartAccount,
          property: axis === 'descriptor' ? 'smartAccount' : 'address',
          value:
            axis === 'descriptor'
              ? {
                  ...store.getState().vault.accounts.SmartAccount[0]
                    .smartAccount,
                  descriptor: { accountIndex: 1 },
                }
              : '0x4444444444444444444444444444444444444444',
        })
      );
    held.release();
    await rejected;
    expect(modules(store.getState().vault)).toEqual([]);
    expect(modules(await loadSlip44State(60))).toEqual([]);
    expect(vaultWrites).toBe(2);
  }
);

it('does not repair an old write into a replacement wallet', async () => {
  const held = holdWrite();
  const saving = add();
  const rejected = expect(saving).rejects.toThrow();
  await held.started;
  wallet.walletStateGeneration++;
  wallet.walletSessionGeneration++;
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'address',
      value: '0x5555555555555555555555555555555555555555',
    })
  );
  const replacementSave = persistCommittedWalletState(true);
  held.release();
  await rejected;
  await replacementSave;
  expect((await loadSlip44State(60)).accounts.SmartAccount[0].address).toBe(
    '0x5555555555555555555555555555555555555555'
  );
  expect(modules(await loadSlip44State(60))).toEqual([]);
  expect(vaultWrites).toBe(2);
});

it('persists healthy read-only hydration without dropping custom records', async () => {
  await add();
  const result = await wallet.hydrateSmartAccount(0);
  expect(result.isDeployed).toBe(false);
  expect(result.customModules).toEqual([record]);
  expect(
    (await loadSlip44State(60)).accounts.SmartAccount[0].smartAccount
  ).toEqual(result);
});

it('allows unrelated label and balance updates during delayed hydration', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  transaction.web3Provider.getCode.mockImplementation(
    async (address: string) => {
      if (address === ACCOUNT) {
        entered();
        await new Promise<void>((resolve) => (release = resolve));
      }
      return '0x';
    }
  );
  const original = store.getState().vault.accounts.SmartAccount[0];
  const hydration = wallet.hydrateSmartAccount(0);
  await started;
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'label',
      value: 'Updated while reading',
    })
  );
  store.dispatch(setAccountBalances({ ethereum: 123, syscoin: 0 }));
  const updated = store.getState().vault.accounts.SmartAccount[0];
  expect(updated).not.toBe(original);
  expect(updated.smartAccount).toBe(original.smartAccount);
  release();
  const result = await hydration;
  const saved = (await loadSlip44State(60)).accounts.SmartAccount[0];
  expect(saved.smartAccount).toEqual(result);
  expect(saved.label).toBe('Updated while reading');
  expect(saved.balances.ethereum).toBe(123);
});

it('refuses a hydration snapshot overtaken by a custom-module edit', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  transaction.web3Provider.getCode.mockImplementation(
    async (address: string) => {
      if (address === ACCOUNT) {
        entered();
        await new Promise<void>((resolve) => (release = resolve));
      }
      return '0x';
    }
  );
  const hydration = wallet.hydrateSmartAccount(0);
  const rejected = expect(hydration).rejects.toThrow(
    'PALI_TRANSACTION_CONTEXT_CHANGED'
  );
  await started;
  await add();
  release();
  await rejected;
  expect(modules(await loadSlip44State(60))).toEqual([record]);
});

it('rejects a stale reviewed account before any persistence attempt', async () => {
  wallet.walletSessionGeneration += 1;
  await expect(add()).rejects.toThrow('PALI_TRANSACTION_CONTEXT_CHANGED');
  expect(vaultWrites).toBe(0);
  expect(modules(await loadSlip44State(60))).toEqual([]);
});

it('serializes same-account forced read and commit without reusing an older snapshot', async () => {
  // Model the post-disable refresh and SignEth's simultaneous forced refresh.
  // Both observe the same post-removal state; no account/authority/session moves.
  const original = store.getState().vault.accounts.SmartAccount[0];
  const descriptor = { accountIndex: 0, deploymentSalt: 'synthetic-stable' };
  const authoritative = {
    ...original.smartAccount,
    descriptor,
    isDeployed: true,
    auth: { module: 'ecdsa', validator: MODULE, data: '0x' },
    installedModules: [
      {
        id: 'ecdsa',
        type: 'validator',
        address: MODULE,
        data: '0x',
        config: { owners: [ACCOUNT], threshold: 1 },
      },
    ],
  };
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'smartAccount',
      value: {
        ...authoritative,
        installedModules: [
          ...authoritative.installedModules,
          {
            id: 'guardian-recovery',
            type: 'executor',
            address: record.address,
          },
        ],
      },
    })
  );
  const finish: Array<(value: any) => void> = [];
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const pending = [
    wallet.hydrateSmartAccount(0),
    wallet.hydrateSmartAccount(0),
  ];
  expect(fetch).toHaveBeenCalledTimes(1);
  finish[0]({ ...authoritative });
  await expect(pending[0]).resolves.toEqual(authoritative);
  expect(fetch).toHaveBeenCalledTimes(2);
  // The queued call performs its own fresh read after the first commit.
  expect((fetch.mock.calls[1][0] as any).smartAccount).toEqual(authoritative);
  finish[1]({ ...authoritative });
  await expect(pending[1]).resolves.toEqual(authoritative);
  const saved = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  expect(saved).toEqual(authoritative);
  expect(store.getState().vault.activeAccount).toEqual({
    id: 0,
    type: KeyringAccountType.SmartAccount,
  });
  expect(wallet.walletSessionGeneration).toBe(0);
  expect(wallet.walletStateGeneration).toBe(0);
  // A subsequent explicit request succeeds after both refreshes settle.
  fetch.mockResolvedValueOnce({ ...authoritative });
  await expect(wallet.hydrateSmartAccount(0)).resolves.toEqual(authoritative);
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it('cleans up a failed refresh and starts a fresh queued read without retrying it', async () => {
  const current = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  let fail!: (error: Error) => void;
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        })
    )
    .mockResolvedValueOnce({ ...current, isDeployed: true });
  const first = wallet.hydrateSmartAccount(0);
  const rejected = expect(first).rejects.toThrow('Read failed');
  const second = wallet.hydrateSmartAccount(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  fail(new Error('Read failed'));
  await rejected;
  await expect(second).resolves.toMatchObject({ isDeployed: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it.each([
  'session',
  'wallet',
  'payer',
  'address',
  'target id',
  'target type',
  'target chain',
  'descriptor',
  'authority',
  'deleted',
  'recreated',
  'rpc',
  'provider',
])(
  'does not retarget a queued refresh after its captured %s changes',
  async (axis) => {
    let fail!: (error: Error) => void;
    const fetch = jest
      .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          })
      );
    const first = wallet.hydrateSmartAccount(0);
    const firstRejected = expect(first).rejects.toThrow('Read failed');
    const second = wallet.hydrateSmartAccount(0);
    const secondRejected = expect(second).rejects.toThrow();
    if (axis === 'session') wallet.walletSessionGeneration++;
    if (axis === 'wallet') wallet.walletStateGeneration++;
    if (axis === 'payer')
      store.dispatch(
        setActiveAccount({ id: 1, type: KeyringAccountType.HDAccount })
      );
    if (axis === 'provider') transaction.web3Provider = {};
    if (axis === 'rpc') {
      const snapshot = store.getState().vault;
      store.dispatch(
        restoreVaultSnapshot({
          ...snapshot,
          activeNetwork: {
            ...snapshot.activeNetwork,
            url: 'https://changed.invalid',
          },
        })
      );
    }
    if (axis === 'deleted' || axis === 'recreated') {
      const snapshot = store.getState().vault;
      const original = snapshot.accounts.SmartAccount[0];
      store.dispatch(
        restoreVaultSnapshot({
          ...snapshot,
          accounts: {
            ...snapshot.accounts,
            SmartAccount:
              axis === 'deleted'
                ? {}
                : {
                    0: {
                      ...original,
                      smartAccount: {
                        ...original.smartAccount,
                        descriptor: { ...original.smartAccount.descriptor },
                      },
                    },
                  },
          },
        })
      );
    }
    if (['address', 'target id', 'target type'].includes(axis)) {
      const property =
        axis === 'address' ? 'address' : axis === 'target id' ? 'id' : 'type';
      const value =
        axis === 'address'
          ? MODULE
          : axis === 'target id'
          ? 2
          : KeyringAccountType.HDAccount;
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: 0,
          type: KeyringAccountType.SmartAccount,
          property,
          value,
        })
      );
    }
    if (['descriptor', 'authority', 'target chain'].includes(axis)) {
      const original = store.getState().vault.accounts.SmartAccount[0];
      store.dispatch(
        setAccountPropertyByIdAndType({
          id: 0,
          type: KeyringAccountType.SmartAccount,
          property: 'smartAccount',
          value: {
            ...original.smartAccount,
            ...(axis === 'descriptor'
              ? { descriptor: { accountIndex: 9 } }
              : axis === 'target chain'
              ? { chainId: 57057 }
              : {
                  auth: { module: 'ecdsa', validator: MODULE, data: '0xabcd' },
                }),
          },
        })
      );
    }
    fail(new Error('Read failed'));
    await firstRejected;
    await secondRejected;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
  }
);

it('waits for the preceding metadata write before starting its fresh RPC read', async () => {
  const original = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockResolvedValue({ ...original, isDeployed: true });
  const held = holdWrite();
  const first = wallet.hydrateSmartAccount(0);
  await held.started;
  const second = wallet.hydrateSmartAccount(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    store.getState().vault.accounts.SmartAccount[0].smartAccount.isDeployed
  ).toBeUndefined();
  held.release();
  await expect(first).resolves.toMatchObject({ isDeployed: true });
  await expect(second).resolves.toMatchObject({ isDeployed: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it('does not weaken the active read CAS when guardian metadata changes mid-read', async () => {
  let finish!: (value: any) => void;
  jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  const original = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  const pending = wallet.hydrateSmartAccount(0);
  const rejected = expect(pending).rejects.toThrow(
    'PALI_TRANSACTION_CONTEXT_CHANGED'
  );
  const updated = {
    ...original,
    installedModules: [
      { id: 'guardian-recovery', type: 'executor', address: MODULE },
    ],
  };
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'smartAccount',
      value: updated,
    })
  );
  finish({ ...original, isDeployed: true });
  await rejected;
  expect(store.getState().vault.accounts.SmartAccount[0].smartAccount).toEqual(
    updated
  );
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it('does not serialize unrelated target accounts behind one another', async () => {
  const snapshot = store.getState().vault;
  const existing = snapshot.accounts.SmartAccount[0];
  store.dispatch(
    restoreVaultSnapshot({
      ...snapshot,
      accounts: {
        ...snapshot.accounts,
        SmartAccount: {
          ...snapshot.accounts.SmartAccount,
          2: {
            ...existing,
            id: 2,
            address: MODULE,
            smartAccount: { ...existing.smartAccount },
          },
        },
      },
    })
  );
  const finish: Array<(value: any) => void> = [];
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const first = wallet.hydrateSmartAccount(0);
  const second = wallet.hydrateSmartAccount(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  finish[0]({ ...existing.smartAccount, isDeployed: true });
  finish[1]({ ...existing.smartAccount, isDeployed: true });
  await expect(first).resolves.toMatchObject({ isDeployed: true });
  await expect(second).resolves.toMatchObject({ isDeployed: true });
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it('does not retarget an old queued approval when the preceding read discovers new owners', async () => {
  const original = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  const oldAuth = { module: 'ecdsa', validator: MODULE, data: '0x1111' };
  const changed = { ...original, auth: { ...oldAuth, data: '0x2222' } };
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 0,
      type: KeyringAccountType.SmartAccount,
      property: 'smartAccount',
      value: { ...original, auth: oldAuth },
    })
  );
  let finish!: (value: any) => void;
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
  const first = wallet.hydrateSmartAccount(0);
  const second = wallet.hydrateSmartAccount(0);
  const rejected = expect(second).rejects.toThrow(
    'PALI_TRANSACTION_CONTEXT_CHANGED'
  );
  finish(changed);
  await expect(first).resolves.toEqual(changed);
  await rejected;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    store.getState().vault.accounts.SmartAccount[0].smartAccount.auth
  ).toEqual(changed.auth);
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});

it('lets a new provider context finish before a retired read and preserves its newer queue entry', async () => {
  const original = store.getState().vault.accounts.SmartAccount[0].smartAccount;
  const finish: Array<(value: any) => void> = [];
  const fetch = jest
    .spyOn(wallet.smartAccount, 'fetchSmartAccountMetadata')
    .mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
  const old = wallet.hydrateSmartAccount(0);
  const oldRejected = expect(old).rejects.toThrow();
  transaction.web3Provider = {};
  const fresh = wallet.hydrateSmartAccount(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  finish[1]({ ...original, isDeployed: true });
  await expect(fresh).resolves.toMatchObject({ isDeployed: true });
  const latest = wallet.hydrateSmartAccount(0);
  expect(fetch).toHaveBeenCalledTimes(3);
  finish[0]({ ...original, isDeployed: false });
  await oldRejected;
  expect(wallet.smartAccount.explicitHydrations.size).toBe(1);
  expect(
    store.getState().vault.accounts.SmartAccount[0].smartAccount.isDeployed
  ).toBe(true);
  finish[2]({ ...original, isDeployed: true });
  await expect(latest).resolves.toMatchObject({ isDeployed: true });
  expect(wallet.smartAccount.explicitHydrations.size).toBe(0);
});
