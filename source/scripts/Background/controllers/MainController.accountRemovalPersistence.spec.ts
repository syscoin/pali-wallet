import { getController } from '..';
import { notificationManager } from 'scripts/Background/notification-manager';
import { addDApp, rehydrate as rehydrateDapps, removeDApp } from 'state/dapp';
import { loadSlip44State, walletPersistenceGate } from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import {
  restoreVaultSnapshot,
  setAccountLabel,
  setAccountPropertyByIdAndType,
  setNetworkChange,
} from 'state/vault';
import vaultCache from 'state/vaultCache';
import { setActiveSlip44 } from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { walletPersistenceMutex } from 'utils/asyncMutex';

import DAppController from './DAppController';
import MainController, { AccountRemovalContext } from './MainController';

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
jest.mock('scripts/Background/notification-manager', () => ({
  notificationManager: { notifyDappConnection: jest.fn() },
}));
jest.mock('utils/syscoinPsbtValues', () => ({}));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const ANCHOR = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const HOST = 'https://account-removal.synthetic.invalid';
const network = {
  kind: INetworkType.Ethereum,
  chainId: 1,
  slip44: 60,
  url: 'https://account-removal-rpc.synthetic.invalid',
  label: 'Synthetic EVM',
  currency: 'eth',
};
const originalChrome = global.chrome;
let records: Record<string, any>;
let refuseNextVaultWrite: boolean;
let wallet: any;
let dapp: ReturnType<typeof DAppController>;
let targetType: KeyringAccountType;
let expected: AccountRemovalContext;

const targetSnapshot = (vault: any) => ({
  account: vault.accounts[targetType]?.[1] || null,
  assets: vault.accountAssets[targetType]?.[1] || null,
  transactions: vault.accountTransactions[targetType]?.[1] || null,
});

const holdNextVaultWrite = () => {
  const entered = deferred();
  const release = deferred();
  const set = chrome.storage.local.set as any;
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback: any) => {
      if (items['state-vault-60'] && !held) {
        held = true;
        entered.resolve();
        void release.promise.then(() => set(items, callback));
      } else set(items, callback);
    });
  return { entered: entered.promise, release: release.resolve };
};

const grantAnchor = () =>
  dapp.requestPermissions(HOST, 0, KeyringAccountType.HDAccount, {
    address: ANCHOR,
    xpub: 'public-anchor',
    network,
  });

const configureTarget = async (
  kind: 'private import' | 'watch import' | 'HD',
  connected = false
) => {
  targetType =
    kind === 'HD' ? KeyringAccountType.HDAccount : KeyringAccountType.Imported;
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: ANCHOR,
    xpub: 'public-anchor',
    label: 'Anchor',
    balances: { ethereum: '1', syscoin: '0' },
  };
  accounts[targetType][1] = {
    id: 1,
    address: TARGET,
    xpub: kind === 'HD' ? 'public-hd-one' : TARGET,
    xprv: kind === 'private import' ? 'synthetic-encrypted-record' : '',
    label: `Saved ${kind}`,
    balances: { ethereum: '2', syscoin: '0' },
  };
  const accountAssets = groups();
  accountAssets[targetType][1] = {
    ethereum: [
      {
        id: 'synthetic-token',
        contractAddress: '0x3333333333333333333333333333333333333333',
        chainId: 1,
        tokenSymbol: 'SAVED',
        decimals: 18,
        balance: 3,
      },
    ],
    syscoin: [],
  };
  const accountTransactions = groups();
  accountTransactions[targetType][1] = {
    ethereum: { 1: [{ hash: `0x${'44'.repeat(32)}`, from: TARGET }] },
    syscoin: {},
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...store.getState().vault,
      accounts,
      accountAssets,
      accountTransactions,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      activeNetwork: network,
      isBitcoinBased: false,
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    rehydrateDapps({
      dapps: connected
        ? {
            [HOST]: {
              host: HOST,
              accountId: 1,
              accountType: targetType,
              chain: INetworkType.Ethereum,
              chainId: 1,
              date: 1,
            },
          }
        : {},
    })
  );
  expected = {
    activeAccount: {
      id: 0,
      type: KeyringAccountType.HDAccount,
      address: ANCHOR,
    },
    address: TARGET,
    network,
    slip44: 60,
  };
  await persistCommittedWalletState(true);
  if (connected) dapp.setup({ url: HOST } as chrome.runtime.MessageSender);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  refuseNextVaultWrite = false;
  global.chrome = {
    runtime: { id: 'synthetic-removal' },
    tabs: { query: jest.fn((_query, callback) => callback([])) },
    scripting: { executeScript: jest.fn(async () => []) },
    storage: {
      local: {
        get: (keys: string[], callback: (value: any) => void) =>
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, clone(records[key])])
            )
          ),
        set: (items: Record<string, any>, callback: () => void) => {
          if (items['state-vault-60'] && refuseNextVaultWrite) {
            refuseNextVaultWrite = false;
            (chrome.runtime as any).lastError = {
              message: 'Account storage unavailable',
            };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, clone(items));
          callback();
        },
      },
    },
  } as any;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  wallet = Object.create(MainController.prototype);
  Object.assign(wallet, {
    resetAutoLockTimer: jest.fn(),
    walletSessionGeneration: 0,
    walletStateGeneration: 0,
    isResettingWallet: false,
  });
  dapp = DAppController(
    () => true,
    () => wallet.walletStateGeneration
  );
  jest.mocked(getController).mockReturnValue({ wallet, dapp } as any);
});

afterEach(() => {
  if (wallet.saveTimeout) clearTimeout(wallet.saveTimeout);
  vaultCache.clearCache();
  global.chrome = originalChrome;
  jest.restoreAllMocks();
});

it.each(['private import', 'watch import', 'HD'] as const)(
  'removes an inactive %s and its history/assets durably while retaining the anchor',
  async (kind) => {
    await configureTarget(kind);
    await wallet.removeAccount(1, targetType, expected);
    const empty = { account: null, assets: null, transactions: null };
    expect(targetSnapshot(store.getState().vault)).toEqual(empty);
    expect(targetSnapshot(await vaultCache.getSlip44Vault(60))).toEqual(empty);
    expect(targetSnapshot(await loadSlip44State(60))).toEqual(empty);
    expect(store.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
    expect(store.getState().vault.accounts.HDAccount[0].address).toBe(ANCHOR);
  }
);

it.each(['private import', 'watch import', 'HD'] as const)(
  'retains an inactive %s after storage refuses removal, including the live cache',
  async (kind) => {
    await configureTarget(kind);
    const before = clone(targetSnapshot(store.getState().vault));
    refuseNextVaultWrite = true;
    await expect(
      wallet.removeAccount(1, targetType, expected)
    ).rejects.toMatchObject({
      message: 'Account storage unavailable',
    });
    const live = targetSnapshot(store.getState().vault);
    const cached = targetSnapshot(await vaultCache.getSlip44Vault(60));
    const cold = await loadSlip44State(60);
    store.dispatch(restoreVaultSnapshot(cold));
    expect({
      live,
      cached,
      restored: targetSnapshot(store.getState().vault),
    }).toEqual({
      live: before,
      cached: before,
      restored: before,
    });
    expect(store.getState().vault.activeAccount).toEqual({
      id: 0,
      type: KeyringAccountType.HDAccount,
    });
  }
);

it('keeps the failed target available for the same explicit removal to be retried', async () => {
  await configureTarget('watch import');
  refuseNextVaultWrite = true;
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).rejects.toMatchObject({
    message: 'Account storage unavailable',
  });
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).resolves.toBeUndefined();
  expect(targetSnapshot(await loadSlip44State(60))).toEqual({
    account: null,
    assets: null,
    transactions: null,
  });
});

it('removes the connected target and its saved grant on a healthy durable removal', async () => {
  await configureTarget('watch import', true);
  expect(dapp.isConnected(HOST)).toBe(true);
  await wallet.removeAccount(1, targetType, expected);
  expect(dapp.isConnected(HOST)).toBe(false);
  expect(records.state.dapp.dapps[HOST]).toBeUndefined();
  expect(notificationManager.notifyDappConnection).toHaveBeenCalledWith(
    HOST,
    false
  );
  expect(targetSnapshot(await loadSlip44State(60))).toEqual({
    account: null,
    assets: null,
    transactions: null,
  });
});

it('does not retire an attached permission or session before account removal is durable', async () => {
  await configureTarget('watch import', true);
  const grant = clone(dapp.get(HOST));
  refuseNextVaultWrite = true;
  await expect(
    wallet.removeAccount(1, targetType, expected)
  ).rejects.toMatchObject({
    message: 'Account storage unavailable',
  });
  expect({
    liveGrant: dapp.get(HOST) || null,
    diskGrant: records.state.dapp.dapps[HOST] || null,
    connectedAddress: dapp.getAccount(HOST)?.address || null,
    disconnected: jest.mocked(notificationManager.notifyDappConnection).mock
      .calls,
  }).toEqual({
    liveGrant: grant,
    diskGrant: grant,
    connectedAddress: TARGET,
    disconnected: [],
  });
});

it('preserves a new permission grant for another account queued after removal started', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  const granting = grantAnchor().then(
    (result) => ({ result, error: null }),
    (error) => ({ result: null, error })
  );
  write.release();
  await removing;
  const outcome = await granting;
  expect(outcome.error).toBeNull();
  expect(outcome.result).toEqual(expect.any(Array));
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(records.state.dapp.dapps[HOST]).toMatchObject({
    accountId: 0,
    accountType: KeyringAccountType.HDAccount,
  });
});

it('preserves a newer unrelated label and its queued save while publishing only target removal', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  expect(targetSnapshot(store.getState().vault).account).not.toBeNull();
  store.dispatch(
    setAccountLabel({
      accountId: 0,
      accountType: KeyringAccountType.HDAccount,
      label: 'New anchor label',
    })
  );
  const saving = persistCommittedWalletState(true);
  write.release();
  await removing;
  await saving;
  expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
    'New anchor label'
  );
  expect((await loadSlip44State(60)).accounts.HDAccount[0].label).toBe(
    'New anchor label'
  );
  expect(targetSnapshot(store.getState().vault).account).toBeNull();
});

it('repairs an accepted stale write without deleting a replacement target', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 1,
      type: targetType,
      property: 'xpub',
      value: 'replacement-public-identity',
    })
  );
  write.release();
  await rejected;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'replacement-public-identity'
  );
  expect((await loadSlip44State(60)).accounts[targetType][1].xpub).toBe(
    'replacement-public-identity'
  );
});

it('repairs the current source vault after a same-slot network change', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const newerNetwork = {
    ...network,
    chainId: 5,
    url: 'https://new-source.synthetic.invalid',
  };
  store.dispatch(setNetworkChange({ activeNetwork: newerNetwork }));
  write.release();
  await rejected;
  expect(store.getState().vault.activeNetwork).toEqual(newerNetwork);
  const cold = await loadSlip44State(60);
  expect(cold.activeNetwork).toEqual(newerNetwork);
  expect(targetSnapshot(cold).account).not.toBeNull();
});

it('repairs the latest cached source slot without replacing the newly active vault', async () => {
  await configureTarget('watch import');
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const newerSource = clone(store.getState().vault);
  newerSource.accounts.HDAccount[0].label = 'Latest cached source label';
  vaultCache.prepareSlip44Vault(60, newerSource);
  const otherVault = clone(newerSource);
  otherVault.activeNetwork = {
    ...network,
    kind: INetworkType.Syscoin,
    chainId: 57,
    slip44: 57,
  } as any;
  otherVault.accounts.HDAccount[0].label = 'Other active vault';
  store.dispatch(setActiveSlip44(57));
  store.dispatch(restoreVaultSnapshot(otherVault));
  write.release();
  await rejected;
  expect(store.getState().vault.accounts.HDAccount[0].label).toBe(
    'Other active vault'
  );
  expect(store.getState().vaultGlobal.activeSlip44).toBe(57);
  const cold = await loadSlip44State(60);
  expect(cold.accounts.HDAccount[0].label).toBe('Latest cached source label');
  expect(targetSnapshot(cold).account).not.toBeNull();
  expect(records.state.vaultGlobal.activeSlip44).toBe(57);
});

it('keeps a newer live grant and session after an in-flight grant-identity change', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow(
    'Account permissions changed'
  );
  await write.entered;
  dapp.syncAccountSession(HOST, 0, KeyringAccountType.HDAccount);
  write.release();
  await rejected;
  expect(dapp.getAccount(HOST)?.address).toBe(ANCHOR);
  expect(records.state.dapp.dapps[HOST].accountId).toBe(0);
  expect(targetSnapshot(store.getState().vault).account).not.toBeNull();
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
});

it('does not carry a queued same-target grant across successful target removal', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  await write.entered;
  const granting = dapp.requestPermissions(HOST, 1, targetType, {
    address: TARGET,
    xpub: TARGET,
    network,
  });
  const rejected = expect(granting).rejects.toThrow(
    'Permission grant context changed'
  );
  write.release();
  await removing;
  await rejected;
  expect(dapp.isConnected(HOST)).toBe(false);
});

it.each(['replacement', 'equal-fields clone'])(
  'never lets a retired predecessor bypass a present %s grant',
  async (kind) => {
    await configureTarget('watch import', true);
    const previous = dapp.get(HOST)!;
    const write = holdNextVaultWrite();
    const removing = wallet.removeAccount(1, targetType, expected);
    await write.entered;
    const releaseGrant = deferred();
    const blockGrant = walletPersistenceMutex.runExclusive(
      () => releaseGrant.promise
    );
    const granting = grantAnchor();
    const rejected = expect(granting).rejects.toThrow(
      'Permission grant context changed'
    );
    write.release();
    await removing;
    const replacement =
      kind === 'equal-fields clone'
        ? { ...previous }
        : {
            ...previous,
            accountId: 0,
            accountType: KeyringAccountType.HDAccount,
            date: 2,
          };
    store.dispatch(addDApp(replacement));
    releaseGrant.resolve();
    await blockGrant;
    await rejected;
    expect(dapp.get(HOST)).toBe(replacement);
  }
);

it('does not reuse a captured retirement for a later pending grant', async () => {
  await configureTarget('watch import', true);
  const previous = dapp.get(HOST)!;
  const retirement = dapp.captureAccountSessionRetirement(1, targetType);
  await wallet.removeAccount(1, targetType, expected);
  retirement.retire();
  // Even reusing the identical old grant object must not revive a consumed
  // retirement for a later attempt. This is stronger than an equal-fields clone.
  store.dispatch(addDApp(previous));
  const release = deferred();
  const blocker = walletPersistenceMutex.runExclusive(() => release.promise);
  const later = grantAnchor();
  const rejected = expect(later).rejects.toThrow(
    'Permission grant context changed'
  );
  store.dispatch(removeDApp(HOST));
  retirement.retire();
  release.resolve();
  await blocker;
  await rejected;
  expect(dapp.isConnected(HOST)).toBe(false);
});

it('does not retire sessions or repair a source snapshot after wallet replacement', async () => {
  await configureTarget('watch import', true);
  const write = holdNextVaultWrite();
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  await write.entered;
  const granting = grantAnchor();
  const rejectedGrant = expect(granting).rejects.toThrow(
    'Permission grant context changed'
  );
  wallet.walletStateGeneration += 1;
  wallet.walletSessionGeneration += 1;
  const replacement = clone(store.getState().vault);
  replacement.accounts[targetType][1].xpub = 'new-wallet-public-identity';
  store.dispatch(restoreVaultSnapshot(replacement));
  vaultCache.clearCache();
  write.release();
  await rejected;
  await rejectedGrant;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'new-wallet-public-identity'
  );
  expect(vaultCache.isVaultCached(60)).toBe(false);
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  expect(notificationManager.notifyDappConnection).not.toHaveBeenCalled();
});

it('refuses a queued removal after its target was replaced before writer admission', async () => {
  await configureTarget('watch import');
  const release = deferred();
  const blocker = walletPersistenceMutex.runExclusive(() => release.promise);
  const writes = jest.spyOn(chrome.storage.local, 'set');
  const removing = wallet.removeAccount(1, targetType, expected);
  const rejected = expect(removing).rejects.toThrow('Account context changed');
  store.dispatch(
    setAccountPropertyByIdAndType({
      id: 1,
      type: targetType,
      property: 'xpub',
      value: 'queued-replacement',
    })
  );
  release.resolve();
  await blocker;
  await rejected;
  expect(store.getState().vault.accounts[targetType][1].xpub).toBe(
    'queued-replacement'
  );
  expect(writes).not.toHaveBeenCalled();
});
