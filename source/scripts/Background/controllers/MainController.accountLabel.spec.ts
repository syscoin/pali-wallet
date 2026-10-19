jest.mock('..', () => ({
  getController: () => ({ dapp: { disconnect: jest.fn() } }),
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

import store from 'state/store';
import vaultReducer, { setAccountLabel } from 'state/vault';
import { KeyringAccountType } from 'types/network';
import { AsyncMutex } from 'utils/asyncMutex';
import { getWalletNavigationScope } from 'utils/navigationState';

import MainController, { AccountLabelEditContext } from './MainController';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('account label identity and durable completion', () => {
  let state: any;
  let wallet: any;
  let expected: AccountLabelEditContext;
  const change = (kind: string) => {
    // Match a separate Redux update rather than mutating Immer-frozen records.
    state = JSON.parse(JSON.stringify(state));
    if (kind === 'slip44') state.vaultGlobal.activeSlip44 = 0;
    if (kind === 'chain') state.vault.activeNetwork.chainId = 0;
    if (kind === 'kind') state.vault.activeNetwork.kind = 'ethereum';
    if (kind === 'rpc') state.vault.activeNetwork.url = 'https://other.invalid';
    if (kind === 'active account') state.vault.activeAccount.id = 0;
    if (kind === 'address')
      state.vault.accounts.HDAccount[1].address = 'other-address';
    if (kind === 'xpub') state.vault.accounts.HDAccount[1].xpub = 'other-xpub';
    if (kind === 'missing account') delete state.vault.accounts.HDAccount[1];
    if (kind === 'session') wallet.walletSessionGeneration += 1;
    if (kind === 'setup') wallet.isCreatingWallet = true;
    if (kind === 'lock') wallet.isUnlocked.mockReturnValue(false);
    if (kind === 'account transition')
      state.vaultGlobal.isSwitchingAccount = true;
    if (kind === 'network transition')
      state.vaultGlobal.networkStatus = 'switching';
    if (kind === 'network connecting')
      state.vaultGlobal.networkStatus = 'connecting';
  };
  const edit = (label = 'Updated label', context = expected) =>
    wallet.editAccountLabel(label, 1, KeyringAccountType.HDAccount, context);
  const label = () => state.vault.accounts.HDAccount[1]?.label;
  const flush = async () => {
    for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
  };

  beforeEach(() => {
    const initial = vaultReducer(undefined, { type: '@@init' });
    state = {
      vault: {
        ...initial,
        activeAccount: { id: 1, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          kind: 'syscoin',
          chainId: 57,
          slip44: 57,
          url: 'https://first.invalid',
        },
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: {
              ...initial.accounts.HDAccount[0],
              address: 'anchor-address',
              xpub: 'anchor-xpub',
            },
            1: {
              ...initial.accounts.HDAccount[0],
              id: 1,
              address: 'first-address',
              xpub: 'first-xpub',
              label: 'Original label',
            },
          },
        },
      },
      vaultGlobal: {
        activeSlip44: 57,
        networkStatus: 'idle',
        isSwitchingAccount: false,
      },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      state = { ...state, vault: vaultReducer(state.vault, action) };
      return action;
    });
    wallet = Object.create(MainController.prototype);
    wallet.walletSessionGeneration = 0;
    wallet.isUnlocked = jest.fn().mockReturnValue(true);
    wallet.accountLabelMutex = new AsyncMutex();
    wallet.saveWalletState = jest.fn().mockResolvedValue(undefined);
    expected = {
      account: { address: 'first-address', xpub: 'first-xpub' },
      walletScope: getWalletNavigationScope(),
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps completion pending until strict synchronous persistence succeeds', async () => {
    const storage = deferred();
    wallet.saveWalletState.mockReturnValue(storage.promise);
    let completed = false;
    const pending = edit().then(() => {
      completed = true;
    });
    await flush();
    expect(label()).toBe('Updated label');
    expect(wallet.saveWalletState).toHaveBeenCalledWith(
      'edit-account-label',
      true,
      true
    );
    expect(completed).toBe(false);
    storage.resolve();
    await pending;
    expect(completed).toBe(true);
  });

  it.each([
    'slip44',
    'chain',
    'kind',
    'rpc',
    'active account',
    'address',
    'xpub',
    'missing account',
    'setup',
    'lock',
    'account transition',
    'network transition',
    'network connecting',
  ])(
    'rejects delivery after a %s change before mutating or saving',
    async (kind) => {
      change(kind);
      const before = JSON.stringify(state);
      await expect(edit()).rejects.toThrow('Account context changed');
      expect(JSON.stringify(state)).toBe(before);
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  );

  it.each([
    undefined,
    {},
    { account: { address: 'first-address' } },
    { walletScope: {} },
  ])(
    'rejects absent or incomplete context without an unscoped fallback',
    async (context) => {
      await expect(
        wallet.editAccountLabel(
          'Wrong label',
          1,
          KeyringAccountType.HDAccount,
          context
        )
      ).rejects.toThrow('Account context changed');
      expect(label()).toBe('Original label');
      expect(wallet.saveWalletState).not.toHaveBeenCalled();
    }
  );

  it('rolls back a failed current save and permits the exact label to be retried', async () => {
    wallet.saveWalletState.mockRejectedValueOnce(
      new Error('Storage unavailable')
    );
    await expect(edit()).rejects.toThrow('Storage unavailable');
    expect(label()).toBe('Original label');
    await expect(edit()).resolves.toBeUndefined();
    expect(label()).toBe('Updated label');
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(2);
  });

  it('propagates the real synchronous save failure instead of the debounced success path', async () => {
    delete wallet.saveWalletState;
    wallet.resetAutoLockTimer = jest.fn();
    wallet.performSave = jest
      .fn()
      .mockRejectedValue(new Error('Synthetic storage refusal'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(edit()).rejects.toThrow('Synthetic storage refusal');
    expect(wallet.performSave).toHaveBeenCalledTimes(1);
    expect(label()).toBe('Original label');
    expect(wallet.saveTimeout).toBeUndefined();
  });

  it('orders a newer label after a failed pending save without reverting its result', async () => {
    const first = deferred();
    wallet.saveWalletState.mockReturnValueOnce(first.promise);
    const earlier = edit('Earlier label');
    const rejected = expect(earlier).rejects.toThrow('Earlier save failed');
    await flush();
    const later = edit('Later label');
    await flush();
    expect(label()).toBe('Earlier label');
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
    first.reject(new Error('Earlier save failed'));
    await rejected;
    await later;
    expect(label()).toBe('Later label');
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(2);
  });

  it('restores the original label when both overlapping edits fail', async () => {
    wallet.saveWalletState.mockRejectedValue(new Error('Storage unavailable'));
    const first = edit('First label');
    const second = edit('Second label');
    await expect(first).rejects.toThrow('Storage unavailable');
    await expect(second).rejects.toThrow('Storage unavailable');
    expect(label()).toBe('Original label');
  });

  it.each(['slip44', 'chain', 'address', 'xpub', 'session'])(
    'does not roll back a different %s context when persistence rejects',
    async (kind) => {
      const storage = deferred();
      wallet.saveWalletState.mockReturnValue(storage.promise);
      const pending = edit();
      const rejected = expect(pending).rejects.toThrow('Storage unavailable');
      await flush();
      change(kind);
      store.dispatch(
        setAccountLabel({
          label: 'New context label',
          accountId: 1,
          accountType: KeyringAccountType.HDAccount,
        })
      );
      storage.reject(new Error('Storage unavailable'));
      await rejected;
      expect(label()).toBe('New context label');
    }
  );

  it('rechecks a queued edit before it can mutate a replacement vault', async () => {
    const storage = deferred();
    wallet.saveWalletState.mockReturnValueOnce(storage.promise);
    const first = edit('First label');
    await flush();
    const queued = edit('Queued label');
    const rejected = expect(queued).rejects.toThrow('Account context changed');
    change('slip44');
    change('address');
    storage.resolve();
    await first;
    await rejected;
    expect(wallet.saveWalletState).toHaveBeenCalledTimes(1);
    expect(label()).toBe('First label');
  });
});
