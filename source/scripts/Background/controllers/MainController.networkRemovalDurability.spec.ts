jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
jest.mock('..', () => ({
  getController: jest.fn(),
  notificationManager: { cleanup: jest.fn() },
}));
jest.mock('./providers/patchFetchWithPaliHeaders', () => ({
  patchFetchWithPaliHeaders: jest.fn(),
}));
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import {
  loadSlip44State,
  loadState,
  walletPersistenceGate,
} from 'state/paliStorage';
import store, { persistCommittedWalletState } from 'state/store';
import { restoreVaultSnapshot, setNetworkChange } from 'state/vault';
import vaultCache from 'state/vaultCache';
import {
  setActiveSlip44,
  setHasEthProperty,
  setNetworks,
} from 'state/vaultGlobal';
import { INetwork, INetworkType, KeyringAccountType } from 'types/network';
import { walletPersistenceMutex } from 'utils/asyncMutex';
import { networkRegistrationFingerprint } from 'utils/networkRegistration';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const FAILURE = 'Synthetic network removal registry refusal';
const originalChrome = global.chrome;
const source: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Current synthetic chain',
  currency: 'eth',
  url: 'https://current.synthetic.invalid',
};
const target: INetwork = {
  chainId: 11111,
  kind: INetworkType.Syscoin,
  slip44: 111,
  label: 'Inactive synthetic chain',
  currency: 'test',
  url: 'https://inactive.synthetic.invalid',
};
const profile = {
  passkeyCredentialProfile: { fixture: 'public synthetic profile' },
};
let wallet: any;
let records: Record<string, any>;
let failRegistry: boolean;
let removedKeys: string[];
let inactiveVault: any;
let commits: Record<string, any>[];
let failReads: boolean;

const projection = async (network = target) => ({
  live:
    store.getState().vaultGlobal.networks[network.kind][network.chainId] ||
    null,
  stored:
    (await loadState()).vaultGlobal.networks[network.kind][network.chainId] ||
    null,
  vault: (await loadSlip44State(111)) || null,
  profile:
    (await chromeStorage.getItem('state-vault-111-passkey-profile')) || null,
  cached: vaultCache.isVaultCached(111),
  keyring: wallet.keyrings.has(111),
});
const remove = (network = target) =>
  wallet.removeKeyringNetwork(
    network.kind,
    network.chainId,
    network.url,
    network.label,
    networkRegistrationFingerprint(network)!
  );
const result = (operation: Promise<unknown>) =>
  operation.then(
    () => ({ success: true }),
    (error: Error) => ({ success: false, error: error.message })
  );
const holdCommit = () => {
  const original = chrome.storage.local.set;
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  let held = false;
  jest
    .spyOn(chrome.storage.local, 'set')
    .mockImplementation((items, callback) => {
      if (items.state && !held) {
        held = true;
        const snapshot = structuredClone(items);
        release = () => original(snapshot, callback);
        entered();
      } else original(items, callback);
    });
  return { started, release: () => release() };
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
  records = {};
  failRegistry = false;
  removedKeys = [];
  commits = [];
  failReads = false;
  walletPersistenceGate.blocked = false;
  vaultCache.clearCache();
  global.chrome = {
    runtime: { id: 'synthetic-network-removal' },
    storage: {
      local: {
        get: (keys: string[], callback: (values: any) => void) => {
          if (failReads) {
            (chrome.runtime as any).lastError = {
              message: 'Synthetic storage read failure',
            };
            callback({});
            delete (chrome.runtime as any).lastError;
            return;
          }
          callback(
            Object.fromEntries(
              keys
                .filter((key) => key in records)
                .map((key) => [key, structuredClone(records[key])])
            )
          );
        },
        set: (items: Record<string, any>, callback: () => void) => {
          commits.push(structuredClone(items));
          if (items.state && failRegistry) {
            failRegistry = false;
            (chrome.runtime as any).lastError = { message: FAILURE };
            callback();
            delete (chrome.runtime as any).lastError;
            return;
          }
          Object.assign(records, structuredClone(items));
          callback();
        },
        remove: (keys: string[], callback: () => void) => {
          for (const key of keys) {
            removedKeys.push(key);
            delete records[key];
          }
          callback();
        },
      },
    },
  } as any;
  const base = store.getState().vault;
  const groups = () =>
    Object.fromEntries(
      Object.values(KeyringAccountType).map((type) => [type, {}])
    );
  const accounts = groups();
  accounts.HDAccount[0] = {
    id: 0,
    address: 'public active account',
    xpub: 'public active xpub',
    label: 'Active',
  };
  store.dispatch(
    restoreVaultSnapshot({
      ...base,
      activeNetwork: source,
      activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
      isBitcoinBased: false,
      accounts,
      accountAssets: groups(),
      accountTransactions: groups(),
    } as any)
  );
  store.dispatch(setActiveSlip44(60));
  store.dispatch(
    setNetworks({ ethereum: { 1: source }, syscoin: { 11111: target } })
  );
  const inactiveAccounts = groups();
  inactiveAccounts.HDAccount[0] = {
    id: 0,
    address: 'public inactive account',
    xpub: 'public inactive xpub',
    label: 'Inactive',
  };
  inactiveVault = {
    ...store.getState().vault,
    activeNetwork: target,
    isBitcoinBased: true,
    accounts: inactiveAccounts,
  };
  // Persist through the actual cache and Chrome adapter, then remove through
  // the actual public controller. No writer or controller result is replaced.
  await vaultCache.setSlip44Vault(111, inactiveVault);
  await chromeStorage.setItem('state-vault-111-passkey-profile', profile);
  await persistCommittedWalletState(true);
  wallet = Object.create(MainController.prototype);
  wallet.walletSessionGeneration = 0;
  wallet.walletStateGeneration = 0;
  wallet.isRemovingNetwork = false;
  wallet.currentPromise = null;
  wallet.resetAutoLockTimer = jest.fn();
  wallet.keyrings = new Map([
    [111, { publicFixture: 'inactive keyring owner' }],
  ]);
  commits = [];
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  vaultCache.clearCache();
  jest.restoreAllMocks();
  global.chrome = originalChrome;
});

it('durably removes a healthy inactive network together with its owned vault and profile', async () => {
  await expect(remove()).resolves.toBeUndefined();
  expect(await projection()).toEqual({
    live: null,
    stored: null,
    vault: null,
    profile: null,
    cached: false,
    keyring: false,
  });
  expect(removedKeys).toEqual([]);
  expect(commits).toHaveLength(1);
  expect(commits[0]['state-vault-111']).toBeNull();
  expect(commits[0]['state-vault-111-passkey-profile']).toBeNull();
});

it('retains an inactive UTXO network and its records after final registry persistence fails, then permits a fresh retry', async () => {
  const before = await projection();
  failRegistry = true;
  const failed = await result(remove());
  const afterFailure = await projection();
  const retry = await result(remove());
  expect({ failed, afterFailure, retry }).toEqual({
    failed: { success: false, error: FAILURE },
    afterFailure: before,
    retry: { success: true },
  });
  expect(await projection()).toEqual({
    live: null,
    stored: null,
    vault: null,
    profile: null,
    cached: false,
    keyring: false,
  });
});

it('does not turn a refused network removal into success via a later ordinary background save', async () => {
  const before = await projection();
  failRegistry = true;
  await expect(remove()).rejects.toMatchObject({ message: FAILURE });
  await wallet.saveCurrentState('ordinary-later-save', false);
  await jest.advanceTimersByTimeAsync(100);
  expect(await projection()).toEqual(before);
});

it('keeps a refused EVM removal visible and retryable without touching another vault', async () => {
  const evm = {
    ...source,
    chainId: 31337,
    label: 'Inactive EVM',
    url: 'https://inactive-evm.synthetic.invalid',
  };
  store.dispatch(
    setNetworks({
      ethereum: { 1: source, 31337: evm },
      syscoin: { 11111: target },
    })
  );
  await persistCommittedWalletState(true);
  const before = await projection(evm);
  failRegistry = true;
  const failed = await result(remove(evm));
  const afterFailure = await projection(evm);
  const retry = await result(remove(evm));
  expect({ failed, afterFailure, retry }).toEqual({
    failed: { success: false, error: FAILURE },
    afterFailure: before,
    retry: { success: true },
  });
  expect((await projection()).vault).toEqual(before.vault);
  expect(removedKeys).toEqual([]);
});

it('keeps registry, cache, keyring and native records live until the single commit succeeds', async () => {
  const before = await projection();
  const held = holdCommit();
  const removing = remove();
  await held.started;
  expect(await projection()).toEqual(before);
  await expect(remove()).rejects.toThrow('already in progress');
  held.release();
  await removing;
  expect(await projection()).toEqual({
    live: null,
    stored: null,
    vault: null,
    profile: null,
    cached: false,
    keyring: false,
  });
});

it.each(['session', 'network ABA', 'same-url replacement'] as const)(
  'repairs the old records and latest main state after a held %s invalidation',
  async (change) => {
    const before = await projection();
    const held = holdCommit();
    const removing = remove();
    const rejected = expect(removing).rejects.toThrow(
      /Wallet session changed|Network changed/
    );
    await held.started;
    if (change === 'same-url replacement') {
      store.dispatch(
        setNetworks({
          ethereum: { 1: source },
          syscoin: { 11111: { ...target, label: 'Replacement registration' } },
        })
      );
    } else {
      wallet.walletSessionGeneration += 1;
      if (change === 'network ABA') {
        store.dispatch(
          setNetworkChange({ activeNetwork: { ...source, chainId: 2 } })
        );
        store.dispatch(setNetworkChange({ activeNetwork: source }));
      }
    }
    store.dispatch(setHasEthProperty(false));
    held.release();
    await rejected;
    const after = await projection();
    expect(after.vault).toEqual(before.vault);
    expect(after.profile).toEqual(before.profile);
    expect(after.keyring).toBe(true);
    expect(after.cached).toBe(true);
    expect(after.stored).toEqual(after.live);
    expect((await loadState()).vaultGlobal.hasEthProperty).toBe(false);
    expect(commits).toHaveLength(2);
    expect(removedKeys).toEqual([]);
  }
);

it('does not repair over a replacement wallet waiting behind the held commit', async () => {
  const held = holdCommit();
  const removing = remove();
  const rejected = expect(removing).rejects.toThrow('Wallet session changed');
  await held.started;
  wallet.walletSessionGeneration += 1;
  wallet.walletStateGeneration += 1;
  const replacement = { ...inactiveVault, marker: 'new wallet data' };
  const replacementKeyring = { publicFixture: 'replacement keyring owner' };
  wallet.keyrings.set(111, replacementKeyring);
  const replacementSave = walletPersistenceMutex.runExclusive(async () => {
    await chromeStorage.setItems({
      'state-vault-111': replacement,
      'state-vault-111-passkey-profile': profile,
    });
  });
  held.release();
  await rejected;
  await replacementSave;
  expect(await loadSlip44State(111)).toEqual(replacement);
  expect(wallet.keyrings.get(111)).toBe(replacementKeyring);
  expect(store.getState().vaultGlobal.networks.syscoin[11111]).toEqual(target);
  expect(commits).toHaveLength(2);
});

it.each(['profile', 'vault and profile'] as const)(
  'keeps an originally absent %s absent after held removal rollback',
  async (missing) => {
    delete records['state-vault-111-passkey-profile'];
    if (missing === 'vault and profile') delete records['state-vault-111'];
    const before = await projection();
    const held = holdCommit();
    const removing = remove();
    const rejected = expect(removing).rejects.toThrow('Wallet session changed');
    await held.started;
    wallet.walletSessionGeneration += 1;
    held.release();
    await rejected;
    expect(await projection()).toEqual(before);
    expect(records['state-vault-111-passkey-profile']).toBeNull();
    if (missing === 'vault and profile')
      expect(records['state-vault-111']).toBeNull();
    expect(commits).toHaveLength(2);
    expect(removedKeys).toEqual([]);
  }
);

it('fails closed on a native snapshot read failure without deleting any records', async () => {
  const before = await projection();
  failReads = true;
  await expect(remove()).rejects.toMatchObject({
    message: 'Synthetic storage read failure',
  });
  failReads = false;
  expect(await projection()).toEqual(before);
  expect(commits).toEqual([]);
  expect(removedKeys).toEqual([]);
});

it('fails closed before reads when recovery owns persistence', async () => {
  walletPersistenceGate.blocked = true;
  await expect(remove()).rejects.toThrow('Wallet recovery');
  walletPersistenceGate.blocked = false;
  expect(commits).toEqual([]);
  expect(removedKeys).toEqual([]);
  expect((await projection()).vault).toEqual(inactiveVault);
});

it('preserves an inactive shared UTXO vault and profile for the surviving registration', async () => {
  const sibling = {
    ...target,
    chainId: 11112,
    url: 'https://shared.synthetic.invalid',
  };
  store.dispatch(
    setNetworks({
      ethereum: { 1: source },
      syscoin: { 11111: target, 11112: sibling },
    })
  );
  await persistCommittedWalletState(true);
  commits = [];
  const before = await projection();
  await remove();
  const after = await projection();
  expect(after).toEqual({ ...before, live: null, stored: null });
  expect(store.getState().vaultGlobal.networks.syscoin[11112]).toEqual(sibling);
  expect(commits).toHaveLength(1);
  expect(Object.keys(commits[0])).toEqual(['state']);
});

it('cold readers treat both tombstones as absent while surviving registry entries remain intact', async () => {
  await remove();
  vaultCache.clearCache();
  expect(await vaultCache.getSlip44Vault(111)).toBeNull();
  expect(
    await chromeStorage.getItem('state-vault-111-passkey-profile')
  ).toBeNull();
  expect(
    (await loadState()).vaultGlobal.networks.syscoin[11111]
  ).toBeUndefined();
  expect((await loadState()).vaultGlobal.networks.ethereum[1]).toEqual(source);
});
