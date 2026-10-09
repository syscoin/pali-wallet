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
import vaultReducer from 'state/vault';
import { INetworkType, KeyringAccountType } from 'types/network';

import MainController, { AccountRemovalContext } from './MainController';

describe('account removal delivery context', () => {
  let state: any;
  let wallet: MainController;
  let expected: AccountRemovalContext;
  const change = (kind: string) => {
    if (kind === 'slip') state.vaultGlobal.activeSlip44 = 0;
    if (kind === 'chain') state.vault.activeNetwork.chainId = 570;
    if (kind === 'kind') state.vault.activeNetwork.kind = INetworkType.Ethereum;
    if (kind === 'rpc') state.vault.activeNetwork.url = 'https://other.example';
    if (kind === 'active id') state.vault.activeAccount.id = 7;
    if (kind === 'active type')
      state.vault.activeAccount.type = KeyringAccountType.Imported;
    if (kind === 'active address')
      state.vault.accounts.HDAccount[0].address = 'new-anchor';
    if (kind === 'selected address')
      state.vault.accounts.HDAccount[7].address = 'different-vault-account';
    if (kind === 'missing account') delete state.vault.accounts.HDAccount[7];
    if (kind === 'account transition')
      state.vaultGlobal.isSwitchingAccount = true;
    if (kind === 'network transition')
      state.vaultGlobal.networkStatus = 'switching';
    if (kind === 'network connecting')
      state.vaultGlobal.networkStatus = 'connecting';
    if (kind === 'reset') (wallet as any).isResettingWallet = true;
  };

  beforeEach(() => {
    const initial = vaultReducer(undefined, { type: '@@init' });
    state = {
      vault: {
        ...initial,
        accounts: {
          ...initial.accounts,
          HDAccount: {
            0: { ...initial.accounts.HDAccount[0], address: 'anchor-address' },
            7: {
              ...initial.accounts.HDAccount[0],
              id: 7,
              address: 'selected-address',
              label: 'Saved account',
            },
          },
        },
        accountAssets: {
          ...initial.accountAssets,
          HDAccount: { 7: { ethereum: [{ symbol: 'SAVED' }], syscoin: [] } },
        },
        accountTransactions: {
          ...initial.accountTransactions,
          HDAccount: {
            7: { ethereum: { 57: [{ hash: 'saved-history' }] }, syscoin: {} },
          },
        },
        activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
        activeNetwork: {
          kind: INetworkType.Syscoin,
          chainId: 57,
          url: 'https://rpc.example',
        },
      },
      vaultGlobal: {
        activeSlip44: 57,
        networkStatus: 'idle',
        isSwitchingAccount: false,
      },
      dapp: { dapps: {} },
    };
    jest.spyOn(store, 'getState').mockImplementation(() => state);
    jest.spyOn(store, 'dispatch').mockImplementation((action: any) => {
      state = { ...state, vault: vaultReducer(state.vault, action) };
      return action;
    });
    wallet = Object.create(MainController.prototype);
    (wallet as any).saveWalletState = jest.fn().mockResolvedValue(undefined);
    expected = {
      activeAccount: {
        id: 0,
        type: KeyringAccountType.HDAccount,
        address: 'anchor-address',
      },
      address: 'selected-address',
      network: { ...state.vault.activeNetwork },
      slip44: 57,
    };
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    'slip',
    'chain',
    'kind',
    'rpc',
    'active id',
    'active type',
    'active address',
    'selected address',
    'missing account',
    'account transition',
    'network transition',
    'network connecting',
    'reset',
  ])(
    'rejects a delivered old confirmation after %s changes without deleting or persisting account data',
    async (kind) => {
      // Models another window changing state after the UI's final preflight,
      // before this queued controller message is handled.
      change(kind);
      const before = JSON.stringify(state);
      await expect(
        wallet.removeAccount(7, KeyringAccountType.HDAccount, expected)
      ).rejects.toThrow('Account context changed');
      expect(JSON.stringify(state)).toBe(before);
      expect(store.dispatch).not.toHaveBeenCalled();
      expect((wallet as any).saveWalletState).not.toHaveBeenCalled();
    }
  );

  it('removes the confirmed account and its records only while the original context remains current', async () => {
    await wallet.removeAccount(7, KeyringAccountType.HDAccount, expected);
    expect(state.vault.accounts.HDAccount[7]).toBeUndefined();
    expect(state.vault.accountAssets.HDAccount[7]).toBeUndefined();
    expect(state.vault.accountTransactions.HDAccount[7]).toBeUndefined();
    expect(state.vault.accounts.HDAccount[0].address).toBe('anchor-address');
    expect((wallet as any).saveWalletState).toHaveBeenCalledWith(
      'remove-account',
      true,
      true
    );
  });

  it('preserves existing two-argument internal callers', async () => {
    await wallet.removeAccount(7, KeyringAccountType.HDAccount);
    expect(state.vault.accounts.HDAccount[7]).toBeUndefined();
  });

  it('rejects malformed context instead of falling back to an unbound removal', async () => {
    await expect(
      wallet.removeAccount(
        7,
        KeyringAccountType.HDAccount,
        {} as AccountRemovalContext
      )
    ).rejects.toThrow('Account context changed');
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
