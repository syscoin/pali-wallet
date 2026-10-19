import { INetworkType, KeyringAccountType } from 'types/network';
import { chromeStorage } from 'utils/storageAPI';

import { walletPersistenceGate } from './paliStorage';
import store, {
  persistAccountLabel,
  persistCommittedWalletState,
} from './store';
import { restoreVaultSnapshot, setAccountLabel } from './vault';
import vaultCache from './vaultCache';
import { setActiveSlip44, setHasEthProperty } from './vaultGlobal';

const SOURCE_SLIP44 = 60;
const SOURCE_KEY = 'state-vault-60';
const original = 'Original label';
const changed = 'Updated label';
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
};
const label = () => store.getState().vault.accounts.HDAccount[0].label;
const currentVault = () => structuredClone(store.getState().vault);

describe('staged account label persistence', () => {
  let disk: Record<string, any>;
  let writes: jest.SpyInstance;
  let current: boolean;
  const assertCurrent = () => {
    if (!current) throw new Error('Account context changed');
  };
  const edit = () =>
    persistAccountLabel(
      0,
      KeyringAccountType.HDAccount,
      changed,
      assertCurrent
    );
  const holdWrite = () => {
    const storage = deferred();
    writes.mockImplementationOnce(async (items) => {
      await storage.promise;
      Object.assign(disk, structuredClone(items));
    });
    return storage;
  };

  beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation();
    walletPersistenceGate.blocked = false;
    vaultCache.clearCache();
    store.dispatch(setActiveSlip44(SOURCE_SLIP44));
    store.dispatch(setHasEthProperty(false));
    const vault = currentVault();
    vault.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
    vault.activeNetwork = {
      ...vault.activeNetwork,
      kind: INetworkType.Ethereum,
      chainId: 1,
      slip44: SOURCE_SLIP44,
      url: 'https://source.invalid',
    };
    vault.accounts.HDAccount[0] = {
      ...vault.accounts.HDAccount[0],
      address: 'public-address',
      xpub: 'public-xpub',
      label: original,
    };
    vault.accounts.HDAccount[1] = {
      ...vault.accounts.HDAccount[0],
      id: 1,
      address: 'other-address',
      xpub: 'other-xpub',
      label: 'Other label',
    };
    store.dispatch(restoreVaultSnapshot(vault));
    disk = {};
    current = true;
    jest
      .spyOn(chromeStorage, 'setItem')
      .mockImplementation(async (key, value) => {
        disk[key] = structuredClone(value);
      });
    writes = jest
      .spyOn(chromeStorage, 'setItems')
      .mockImplementation(async (items) => {
        Object.assign(disk, structuredClone(items));
      });
    await persistCommittedWalletState(true);
    writes.mockClear();
  });

  afterEach(() => {
    walletPersistenceGate.blocked = false;
    jest.restoreAllMocks();
    vaultCache.clearCache();
  });

  it.each([true, false])(
    'keeps Redux, cache and queued emergency save consistent when label storage succeeds=%s',
    async (succeeds) => {
      const storage = holdWrite();
      const setting = edit();
      const completion = succeeds
        ? expect(setting).resolves.toBeUndefined()
        : expect(setting).rejects.toThrow('Storage unavailable');
      await flush();
      expect(label()).toBe(original);
      expect(disk[SOURCE_KEY].accounts.HDAccount[0].label).toBe(original);
      expect(
        (await vaultCache.getSlip44Vault(SOURCE_SLIP44))?.accounts.HDAccount[0]
          .label
      ).toBe(original);
      store.dispatch(setHasEthProperty(true));
      const background = vaultCache.emergencySave();
      if (succeeds) storage.resolve();
      else storage.reject(new Error('Storage unavailable'));
      await completion;
      await background;
      const expected = succeeds ? changed : original;
      expect(label()).toBe(expected);
      expect(disk[SOURCE_KEY].accounts.HDAccount[0].label).toBe(expected);
      expect(
        (await vaultCache.getSlip44Vault(SOURCE_SLIP44))?.accounts.HDAccount[0]
          .label
      ).toBe(expected);
      expect(disk.state.vaultGlobal.hasEthProperty).toBe(true);
    }
  );

  it('preserves other live vault changes when publishing and caching the committed label', async () => {
    const storage = holdWrite();
    const setting = edit();
    await flush();
    store.dispatch(
      setAccountLabel({
        accountId: 1,
        accountType: KeyringAccountType.HDAccount,
        label: 'Other updated label',
      })
    );
    storage.resolve();
    await setting;
    expect(label()).toBe(changed);
    expect(store.getState().vault.accounts.HDAccount[1].label).toBe(
      'Other updated label'
    );
    expect(
      (await vaultCache.getSlip44Vault(SOURCE_SLIP44))?.accounts.HDAccount[1]
        .label
    ).toBe('Other updated label');
    await vaultCache.emergencySave();
    expect(disk[SOURCE_KEY].accounts.HDAccount[1].label).toBe(
      'Other updated label'
    );
  });

  it('does not create a cache entry for a failed staged label', async () => {
    vaultCache.clearCache();
    const storage = holdWrite();
    const setting = edit();
    const rejected = expect(setting).rejects.toThrow('Storage unavailable');
    await flush();
    expect(vaultCache.isVaultCached(SOURCE_SLIP44)).toBe(false);
    storage.reject(new Error('Storage unavailable'));
    await rejected;
    expect(vaultCache.isVaultCached(SOURCE_SLIP44)).toBe(false);
    expect(label()).toBe(original);
  });

  it('repairs from the latest same-slip44 vault after a network/session change', async () => {
    const storage = holdWrite();
    const setting = edit();
    const rejected = expect(setting).rejects.toThrow('Account context changed');
    await flush();
    const destination = currentVault();
    destination.activeNetwork = {
      ...destination.activeNetwork,
      chainId: 137,
      url: 'https://destination.invalid',
    };
    destination.accounts.HDAccount[0].label = 'Current network label';
    store.dispatch(restoreVaultSnapshot(destination));
    vaultCache.prepareSlip44Vault(SOURCE_SLIP44, destination);
    current = false;
    storage.resolve();
    await rejected;
    expect(disk[SOURCE_KEY].activeNetwork.chainId).toBe(137);
    expect(disk[SOURCE_KEY].accounts.HDAccount[0].label).toBe(
      'Current network label'
    );
    expect(
      (await vaultCache.getSlip44Vault(SOURCE_SLIP44))?.activeNetwork.chainId
    ).toBe(137);
    expect(writes).toHaveBeenCalledTimes(2);
  });

  it('repairs only the original source slot after switching to another slip44', async () => {
    const storage = holdWrite();
    const setting = edit();
    const rejected = expect(setting).rejects.toThrow('Account context changed');
    await flush();
    const destination = currentVault();
    destination.activeNetwork = {
      ...destination.activeNetwork,
      kind: INetworkType.Syscoin,
      chainId: 57,
      slip44: 57,
      url: 'https://other-vault.invalid',
    };
    destination.accounts.HDAccount[0].label = 'Destination label';
    disk['state-vault-57'] = structuredClone(destination);
    store.dispatch(setActiveSlip44(57));
    store.dispatch(restoreVaultSnapshot(destination));
    vaultCache.prepareSlip44Vault(57, destination);
    current = false;
    storage.resolve();
    await rejected;
    expect(disk[SOURCE_KEY].accounts.HDAccount[0].label).toBe(original);
    expect(disk['state-vault-57']).toEqual(destination);
    expect(label()).toBe('Destination label');
    expect(disk.state.vaultGlobal.activeSlip44).toBe(57);
    expect(
      (await vaultCache.getSlip44Vault(57))?.accounts.HDAccount[0].label
    ).toBe('Destination label');
  });

  it('does not repopulate a cache cleared by lock/reset while storage was pending', async () => {
    const storage = holdWrite();
    const setting = edit();
    const rejected = expect(setting).rejects.toThrow('Account context changed');
    await flush();
    current = false;
    vaultCache.clearCache();
    storage.resolve();
    await rejected;
    expect(label()).toBe(original);
    expect(disk[SOURCE_KEY].accounts.HDAccount[0].label).toBe(original);
    expect(vaultCache.isVaultCached(SOURCE_SLIP44)).toBe(false);
  });
});
