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
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn().mockResolvedValue(null),
    removeItem: jest.fn(),
    setItem: jest.fn(),
  },
}));

import store from 'state/store';
import vaultCache from 'state/vaultCache';
import vaultGlobalReducer from 'state/vaultGlobal';
import { INetworkType, KeyringAccountType } from 'types/network';
import { networkSwitchMutex, walletPersistenceMutex } from 'utils/asyncMutex';
import { chromeStorage } from 'utils/storageAPI';

import MainController from './MainController';

const target = {
  chainId: 999,
  currency: 'TEST',
  kind: INetworkType.Syscoin,
  label: 'Custom test chain',
  slip44: 1,
  url: 'https://target.example',
};
const source = {
  ...target,
  chainId: 57,
  slip44: 57,
  url: 'https://source.example',
};
const removeTarget = (wallet: MainController) =>
  wallet.removeKeyringNetwork(
    target.kind,
    target.chainId,
    target.url,
    target.label
  );
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('network removal cannot delete a switching or active vault', () => {
  let wallet: any;
  let state: any;
  let persisted: Map<string, unknown>;
  let sourceKeyring: object;
  let targetKeyring: object;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    state = {
      vault: {
        activeNetwork: source,
        activeAccount: { id: 7, type: KeyringAccountType.HDAccount },
        accounts: {
          HDAccount: {
            7: { address: 'source-account', label: 'Saved account' },
          },
        },
        accountTransactions: {
          HDAccount: { 7: { syscoin: { 57: ['saved-history'] } } },
        },
      },
      vaultGlobal: {
        activeSlip44: 57,
        networkStatus: 'idle',
        isSwitchingAccount: false,
        networks: { syscoin: { 57: source, 999: target }, ethereum: {} },
      },
    };
    persisted = new Map([
      [
        'state-vault-57',
        { accounts: 'source-accounts', history: 'source-history' },
      ],
      [
        'state-vault-1',
        { accounts: 'target-accounts', history: 'target-history' },
      ],
      ['state-vault-1-passkey-profile', { profile: 'target-profile' }],
    ]);
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      state.vaultGlobal = vaultGlobalReducer(state.vaultGlobal, action);
      return action;
    });
    jest.spyOn(vaultCache, 'clearSlip44FromCache').mockImplementation();
    jest
      .mocked(chromeStorage.removeItem)
      .mockReset()
      .mockImplementation(async (key) => {
        persisted.delete(key);
      });
    wallet = Object.create(MainController.prototype);
    sourceKeyring = { id: 'source-keyring' };
    targetKeyring = { id: 'target-keyring' };
    wallet.keyrings = new Map([
      [57, sourceKeyring],
      [1, targetKeyring],
    ]);
    wallet.walletSessionGeneration = 0;
    wallet.walletStateGeneration = 0;
    wallet.networkRequestGeneration = 0;
    wallet.isNetworkSwitching = false;
    wallet.isRemovingNetwork = false;
    wallet.currentPromise = null;
    wallet.saveWalletState = jest.fn().mockResolvedValue(undefined);
    wallet.evmAssetsController = {
      detectCoinGeckoIds: jest.fn().mockResolvedValue(null),
    };
    wallet.stopAllRapidPolling = jest.fn();
    wallet.cancellablePromises = {};
    wallet.cancelActiveBalanceUpdate = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  it.each([
    'switching',
    'connecting',
    'internal switch',
    'pending request',
    'reset',
    'creation',
  ])(
    'rejects removal during %s without touching accounts, history, keyrings or storage',
    async (condition) => {
      if (condition === 'switching' || condition === 'connecting')
        state.vaultGlobal.networkStatus = condition;
      if (condition === 'internal switch') wallet.isNetworkSwitching = true;
      if (condition === 'pending request')
        wallet.currentPromise = {
          cancel: jest.fn(),
          promise: new Promise(() => undefined),
        };
      if (condition === 'reset') wallet.isResettingWallet = true;
      if (condition === 'creation') wallet.isCreatingWallet = true;
      const before = JSON.stringify(state);
      const storageBefore = [...persisted];
      await expect(removeTarget(wallet)).rejects.toThrow(/Network|Wallet/);
      expect(JSON.stringify(state)).toBe(before);
      expect([...persisted]).toEqual(storageBefore);
      expect(wallet.keyrings.get(57)).toBe(sourceKeyring);
      expect(wallet.keyrings.get(1)).toBe(targetKeyring);
      expect(chromeStorage.removeItem).not.toHaveBeenCalled();
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  );

  it.each([
    'exact active network',
    'active network with stale URL',
    'same active slip44',
  ])(
    'rejects deleting %s even when delivered directly to the backend',
    async (condition) => {
      let network = source;
      if (condition === 'active network with stale URL')
        network = { ...source, url: 'https://stale.example' };
      if (condition === 'same active slip44') {
        network = { ...target, slip44: 57 };
        state.vaultGlobal.networks.syscoin[999] = network;
      }
      const before = JSON.stringify(state);
      await expect(
        wallet.removeKeyringNetwork(
          network.kind,
          network.chainId,
          network.url,
          network.label
        )
      ).rejects.toThrow(/active network|Network changed/);
      expect(JSON.stringify(state)).toBe(before);
      expect(chromeStorage.removeItem).not.toHaveBeenCalled();
      expect(wallet.keyrings.get(57)).toBe(sourceKeyring);
    }
  );

  it('awaits deletion and persistence before allowing another network switch', async () => {
    let release!: () => void;
    let started!: () => void;
    const deleting = new Promise<void>((resolve) => (started = resolve));
    jest
      .mocked(chromeStorage.removeItem)
      .mockImplementationOnce(async (key) => {
        started();
        await new Promise<void>((resolve) => (release = resolve));
        persisted.delete(key);
      });
    const removing = removeTarget(wallet);
    await deleting;
    expect(state.vaultGlobal.networks.syscoin[999]).toBe(target);
    expect(wallet.keyrings.get(1)).toBe(targetKeyring);
    await expect(wallet.setActiveNetwork(target)).rejects.toThrow(
      'Network removal'
    );
    await expect(wallet.switchActiveKeyring(target)).rejects.toThrow(
      'Network removal'
    );
    expect(wallet.networkRequestGeneration).toBe(0);
    expect(wallet.stopAllRapidPolling).not.toHaveBeenCalled();
    release();
    await removing;
    expect(persisted.has('state-vault-1')).toBe(false);
    expect(persisted.has('state-vault-1-passkey-profile')).toBe(false);
    expect(state.vaultGlobal.networks.syscoin[999]).toBeUndefined();
    expect(wallet.keyrings.has(1)).toBe(false);
    expect(wallet.keyrings.get(57)).toBe(sourceKeyring);
    expect(state.vault.accounts.HDAccount[7].address).toBe('source-account');
    expect(state.vault.accountTransactions.HDAccount[7].syscoin[57]).toEqual([
      'saved-history',
    ]);
    expect(wallet.saveWalletState).toHaveBeenCalledWith(
      'remove-network',
      true,
      true
    );
    expect(wallet.isRemovingNetwork).toBe(false);
  });

  it.each(['edit', 'add'])(
    'rejects network %s during an awaited vault deletion',
    async (operation) => {
      let release!: () => void;
      let started!: () => void;
      const deleting = new Promise<void>((resolve) => (started = resolve));
      jest
        .mocked(chromeStorage.removeItem)
        .mockImplementationOnce(async (key) => {
          started();
          await new Promise<void>((resolve) => (release = resolve));
          persisted.delete(key);
        });
      const removing = removeTarget(wallet);
      await deleting;
      try {
        const mutation =
          operation === 'edit'
            ? wallet.editCustomRpc({ ...target, url: 'https://edited.example' })
            : wallet.addCustomRpc({
                ...target,
                kind: INetworkType.Ethereum,
                chainId: 123,
              });
        await expect(mutation).rejects.toThrow('Network removal');
        expect(state.vaultGlobal.networks.syscoin[999]).toBe(target);
        expect(state.vaultGlobal.networks.ethereum[123]).toBeUndefined();
        expect(
          wallet.evmAssetsController.detectCoinGeckoIds
        ).not.toHaveBeenCalled();
      } finally {
        release();
        await removing.catch(() => undefined);
      }
    }
  );

  it('rejects an add started earlier when metadata resolves during deletion', async () => {
    let resolveMetadata!: (value: unknown) => void;
    wallet.evmAssetsController.detectCoinGeckoIds.mockImplementationOnce(
      () => new Promise((resolve) => (resolveMetadata = resolve))
    );
    const adding = wallet.addCustomRpc({
      ...target,
      kind: INetworkType.Ethereum,
      chainId: 123,
    });
    const addOutcome = adding.then(
      () => 'added',
      (error: Error) => error.message
    );
    let release!: () => void;
    let started!: () => void;
    const deleting = new Promise<void>((resolve) => (started = resolve));
    jest
      .mocked(chromeStorage.removeItem)
      .mockImplementationOnce(async (key) => {
        started();
        await new Promise<void>((resolve) => (release = resolve));
        persisted.delete(key);
      });
    const removing = removeTarget(wallet);
    await deleting;
    try {
      resolveMetadata({ coingeckoId: 'test' });
      expect(await addOutcome).toMatch(/Network removal/);
      expect(state.vaultGlobal.networks.ethereum[123]).toBeUndefined();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    } finally {
      release();
      await removing.catch(() => undefined);
    }
  });

  it('rechecks a queued removal after the prior switch changes the active vault', async () => {
    let release!: () => void;
    const barrier = networkSwitchMutex.runExclusive(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await flush();
    const removing = removeTarget(wallet);
    const rejected = expect(removing).rejects.toThrow(
      /active network|Network changed/
    );
    await flush();
    state.vault.activeNetwork = target;
    state.vaultGlobal.activeSlip44 = 1;
    release();
    await barrier;
    await rejected;
    expect(chromeStorage.removeItem).not.toHaveBeenCalled();
    expect(wallet.keyrings.get(1)).toBe(targetKeyring);
    expect(wallet.isRemovingNetwork).toBe(false);
  });

  it.each(['session', 'reset'])(
    'rejects a queued removal after the wallet %s changes',
    async (kind) => {
      let release!: () => void;
      const barrier = networkSwitchMutex.runExclusive(
        () => new Promise<void>((resolve) => (release = resolve))
      );
      await flush();
      const removing = removeTarget(wallet);
      const rejected = expect(removing).rejects.toThrow(
        'Wallet session changed'
      );
      await flush();
      if (kind === 'session') wallet.walletSessionGeneration += 1;
      else wallet.walletStateGeneration += 1;
      release();
      await barrier;
      await rejected;
      expect(chromeStorage.removeItem).not.toHaveBeenCalled();
      expect(wallet.isRemovingNetwork).toBe(false);
    }
  );

  it.each(['RPC changed', 'slip44 changed', 'deleted'])(
    'rejects stale network identity after waiting (%s)',
    async (kind) => {
      let release!: () => void;
      const barrier = networkSwitchMutex.runExclusive(
        () => new Promise<void>((resolve) => (release = resolve))
      );
      await flush();
      const removing = removeTarget(wallet);
      const rejected = expect(removing).rejects.toThrow('Network changed');
      await flush();
      if (kind === 'deleted') delete state.vaultGlobal.networks.syscoin[999];
      else
        state.vaultGlobal.networks.syscoin[999] = {
          ...target,
          ...(kind === 'RPC changed'
            ? { url: 'https://replacement.example' }
            : { slip44: 2 }),
        };
      release();
      await barrier;
      await rejected;
      expect(chromeStorage.removeItem).not.toHaveBeenCalled();
      expect(wallet.keyrings.get(1)).toBe(targetKeyring);
      expect(wallet.isRemovingNetwork).toBe(false);
    }
  );

  it('rejects a second removal and a new switch until persistence completes', async () => {
    let release!: () => void;
    let started!: () => void;
    const saving = new Promise<void>((resolve) => (started = resolve));
    wallet.saveWalletState.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => (release = resolve));
    });
    const removing = removeTarget(wallet);
    await saving;
    await expect(wallet.setActiveNetwork(source)).rejects.toThrow(
      'Network removal'
    );
    await expect(removeTarget(wallet)).rejects.toThrow('Network removal');
    release();
    await removing;
    expect(wallet.isRemovingNetwork).toBe(false);
  });

  it('propagates a storage failure and releases removal without deleting its keyring or network', async () => {
    jest
      .mocked(chromeStorage.removeItem)
      .mockRejectedValueOnce(Error('Storage unavailable'));
    await expect(removeTarget(wallet)).rejects.toThrow('Storage unavailable');
    expect(wallet.keyrings.get(1)).toBe(targetKeyring);
    expect(state.vaultGlobal.networks.syscoin[999]).toBe(target);
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(wallet.isRemovingNetwork).toBe(false);
    await removeTarget(wallet);
    expect(state.vaultGlobal.networks.syscoin[999]).toBeUndefined();
  });

  it('finishes old deletion before a reset can persist a replacement vault', async () => {
    let release!: () => void;
    let started!: () => void;
    const deleting = new Promise<void>((resolve) => (started = resolve));
    jest
      .mocked(chromeStorage.removeItem)
      .mockImplementationOnce(async (key) => {
        started();
        await new Promise<void>((resolve) => (release = resolve));
        persisted.delete(key);
      });
    const removing = removeTarget(wallet);
    const rejected = expect(removing).rejects.toThrow('Wallet session changed');
    await deleting;
    wallet.walletSessionGeneration += 1;
    wallet.walletStateGeneration += 1;
    const replacement = {
      accounts: 'new-wallet-accounts',
      history: 'new-wallet-history',
    };
    const resetWrite = walletPersistenceMutex.runExclusive(async () => {
      persisted.set('state-vault-1', replacement);
      persisted.set('state-vault-1-passkey-profile', {
        profile: 'new-profile',
      });
    });
    await flush();
    expect(persisted.get('state-vault-1')).not.toBe(replacement);
    release();
    await rejected;
    await resetWrite;
    expect(persisted.get('state-vault-1')).toBe(replacement);
    expect(persisted.get('state-vault-1-passkey-profile')).toEqual({
      profile: 'new-profile',
    });
    expect(wallet.saveWalletState).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
    expect(wallet.isRemovingNetwork).toBe(false);
  });

  it('waits for persistence ownership before clearing storage and rechecks the session', async () => {
    let release!: () => void;
    const barrier = walletPersistenceMutex.runExclusive(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    await flush();
    const removing = removeTarget(wallet);
    const rejected = expect(removing).rejects.toThrow('Wallet session changed');
    await flush();
    expect(chromeStorage.removeItem).not.toHaveBeenCalled();
    wallet.walletSessionGeneration += 1;
    release();
    await barrier;
    await rejected;
    expect(chromeStorage.removeItem).not.toHaveBeenCalled();
  });
});
