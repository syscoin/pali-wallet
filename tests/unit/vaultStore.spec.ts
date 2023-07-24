import {
  initialActiveHdAccountState,
  initialActiveImportedAccountState,
  initialActiveTrezorAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring'; //todo: initialActiveAccountState does not exist anymore we should adjust it
import { INetworkType } from '@pollum-io/sysweb3-network';

import { MOCK_ACCOUNT, STATE_W_ACCOUNT } from '../mocks';
import reducer, {
  createAccount,
  forgetWallet,
  initialState,
  removeAccount,
  removeAccounts,
  removeNetwork,
  setAccountLabel,
  setActiveAccount,
  setActiveAccountProperty,
  setActiveNetwork,
  setIsLoadingBalances,
  setLastLogin,
  setTimer,
} from 'state/vault';
import { IVaultState } from 'state/vault/types';

describe('Vault store actions', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, { type: undefined })).toEqual(initialState);
  });

  //* setTimer
  it('should set the autolock timer', () => {
    const payload = 10;
    const newState = reducer(initialState, setTimer(payload));

    expect(newState.timer).toEqual(payload);
  });

  //* setLastLogin
  it('should set the last login to current datetime', () => {
    const startTime = Date.now();

    const newState = reducer(initialState, setLastLogin());

    const { lastLogin } = newState;
    expect(lastLogin).toBeGreaterThanOrEqual(startTime);
    expect(lastLogin).toBeLessThanOrEqual(Date.now());
  });

  //* createAccount
  it('should create an account', () => {
    const newState = reducer(
      initialState,
      createAccount({
        account: MOCK_ACCOUNT,
        accountType: KeyringAccountType.HDAccount,
      })
    );

    expect(
      newState.accounts[KeyringAccountType.HDAccount][MOCK_ACCOUNT.id]
    ).toEqual(MOCK_ACCOUNT);
  });

  describe('accounts removal methods', () => {
    const fakeAccount1 = MOCK_ACCOUNT;
    const fakeAccount2 = {
      ...fakeAccount1,
      id: 27,
    };

    const stateWithAccounts: IVaultState = {
      ...initialState,
      accounts: {
        ...initialState.accounts,
        [KeyringAccountType.HDAccount]: {
          [fakeAccount1.id]: fakeAccount1,
          [fakeAccount2.id]: fakeAccount2,
        },
      },
    };

    //* removeAccount
    it('should remove an account', () => {
      const payload = {
        id: fakeAccount1.id,
        type: KeyringAccountType.HDAccount,
      };
      const newState = reducer(stateWithAccounts, removeAccount(payload));

      expect(
        newState.accounts[KeyringAccountType.HDAccount][fakeAccount1.id]
      ).not.toBeDefined();
      expect(
        newState.accounts[KeyringAccountType.HDAccount][fakeAccount2.id]
      ).toBeDefined();
    });

    //* removeAccounts
    it('should remove all accounts', () => {
      const newState = reducer(stateWithAccounts, removeAccounts());

      expect(newState.accounts).toEqual({
        HDAccount: {
          0: {
            ...initialActiveHdAccountState,
            assets: { syscoin: [], ethereum: [] },
            transactions: {
              ethereum: {},
              syscoin: {},
            },
          },
        },
        Imported: {
          0: {
            ...initialActiveImportedAccountState,
            assets: { syscoin: [], ethereum: [] },
            transactions: {
              ethereum: {},
              syscoin: {},
            },
          },
        },
        Trezor: {
          0: {
            ...initialActiveTrezorAccountState,
            assets: { syscoin: [], ethereum: [] },
            transactions: {
              ethereum: {},
              syscoin: {},
            },
          },
        },
      });
    });
  });

  //* forgetWallet
  it('should forget the wallet', () => {
    const newState = reducer(undefined, forgetWallet());

    expect(newState).toEqual(initialState);
  });

  //* setActiveNetwork
  it('should set the active network)', () => {
    const sysTestnet = initialState.networks.syscoin[5700];
    const newState = reducer(initialState, setActiveNetwork(sysTestnet));

    expect(newState.activeNetwork).toEqual(sysTestnet);
  });

  //* setActiveAccount
  it('should set the active account)', () => {
    const newState = reducer(
      initialState,
      setActiveAccount({
        id: MOCK_ACCOUNT.id,
        type: KeyringAccountType.HDAccount,
      })
    );

    expect(newState.activeAccount.id).toEqual(MOCK_ACCOUNT.id);
  });

  //* setActiveAccountProperty
  it('should set a property for the active account)', () => {
    // state with `accounts` and `activeAccount` populated
    let customState = reducer(
      initialState,
      createAccount({
        account: MOCK_ACCOUNT,
        accountType: KeyringAccountType.HDAccount,
      })
    );
    customState = reducer(
      customState,
      setActiveAccount({
        id: MOCK_ACCOUNT.id,
        type: KeyringAccountType.HDAccount,
      })
    );

    const payload = { property: 'label', value: 'New Account Label' };
    const newState = reducer(customState, setActiveAccountProperty(payload));

    const { activeAccount } = newState;
    const currentActiveAccount =
      newState.accounts[activeAccount.type][activeAccount.id];
    expect(currentActiveAccount[payload.property]).toEqual(payload.value);
  });

  //* setAccountLabel
  it('should set the label for an account)', () => {
    // 15 = mock account id
    const payload = {
      id: 15,
      label: 'Label',
      type: KeyringAccountType.HDAccount,
    };
    const newState = reducer(STATE_W_ACCOUNT, setAccountLabel(payload));

    const account = newState.accounts[KeyringAccountType.HDAccount][payload.id];
    expect(account.label).toEqual(payload.label);
  });

  //* setIsLoadingBalances
  it('should set the label for an account)', () => {
    const payload = true;
    const newState = reducer(initialState, setIsLoadingBalances(payload));

    expect(newState.isLoadingBalances).toBe(true);
  });

  //* removeNetwork
  it('should remove a network)', () => {
    const payload = {
      chain: INetworkType.Ethereum,
      chainId: 4,
      label: '',
      rpcUrl: '',
    };
    const newState = reducer(initialState, removeNetwork(payload));

    expect(newState.networks.ethereum).toBeDefined();
    expect(newState.networks.ethereum[4]).toBeUndefined();
  });
});
