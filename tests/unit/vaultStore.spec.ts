import { AES } from 'crypto-js';

import { MOCK_ACCOUNT, STATE_W_ACCOUNT } from '../mocks';
import reducer, {
  createAccount,
  forgetWallet,
  initialState,
  removeAccount,
  removeAccounts,
  removeNetwork,
  setAccountLabel,
  setAccountTransactions,
  setActiveAccount,
  setActiveAccountProperty,
  setActiveNetwork,
  setEncryptedMnemonic,
  setIsPendingBalances,
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

  //* setEncryptedMnemonic
  it('should set the encrypted mnemonic', () => {
    const mnemonic =
      'buffalo parade cotton festival trap gap judge slush wall top tired club';
    const password = 'st0rngp@ssword';
    const payload = AES.encrypt(mnemonic, password).toString();

    const newState = reducer(initialState, setEncryptedMnemonic(payload));

    expect(newState.encryptedMnemonic).toEqual(payload.toString());
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
    const newState = reducer(initialState, createAccount(MOCK_ACCOUNT));

    expect(newState.accounts[MOCK_ACCOUNT.id]).toEqual(MOCK_ACCOUNT);
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
        [fakeAccount1.id]: fakeAccount1,
        [fakeAccount2.id]: fakeAccount2,
      },
    };

    //* removeAccount
    it('should remove an account', () => {
      const payload = { id: fakeAccount1.id };
      const newState = reducer(stateWithAccounts, removeAccount(payload));

      expect(newState.accounts[fakeAccount1.id]).not.toBeDefined();
      expect(newState.accounts[fakeAccount2.id]).toBeDefined();
    });

    //* removeAccounts
    it('should remove all accounts', () => {
      const newState = reducer(stateWithAccounts, removeAccounts());

      expect(newState.accounts).toEqual({});
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
    const newState = reducer(initialState, setActiveAccount(MOCK_ACCOUNT.id));

    expect(newState.activeAccount).toEqual(MOCK_ACCOUNT);
  });

  //* setActiveAccountProperty
  it('should set a property for the active account)', () => {
    // state with `accounts` and `activeAccount` populated
    let customState = reducer(initialState, createAccount(MOCK_ACCOUNT));
    customState = reducer(customState, setActiveAccount(MOCK_ACCOUNT.id));

    const payload = { property: 'label', value: 'New Account Label' };
    const newState = reducer(customState, setActiveAccountProperty(payload));

    const { activeAccount } = newState;
    expect(activeAccount[payload.property]).toEqual(payload.value);
  });

  //* setAccountLabel
  it('should set the label for an account)', () => {
    // 15 = mock account id
    const payload = { id: 15, label: 'Label' };
    const newState = reducer(STATE_W_ACCOUNT, setAccountLabel(payload));

    const account = newState.accounts[payload.id];
    expect(account.label).toEqual(payload.label);
  });

  //* setIsPendingBalances
  it('should set the label for an account)', () => {
    const payload = true;
    const newState = reducer(initialState, setIsPendingBalances(payload));

    expect(newState.isPendingBalances).toBe(true);
  });

  //* setAccountTransactions
  it('should add a transaction for the active account)', () => {
    const payload = { hmm: 'hue' };

    const customState = reducer(
      STATE_W_ACCOUNT,
      setActiveAccount(MOCK_ACCOUNT.id)
    );
    const newState = reducer(customState, setAccountTransactions(payload));

    const id = newState.activeAccount;
    const account = newState.accounts[id];
    expect(account.transactions).toContain(payload);
  });

  //* removeNetwork
  it('should remove a network)', () => {
    const payload = { prefix: 'ethereum', chainId: 4 };
    const newState = reducer(initialState, removeNetwork(payload));

    expect(newState.networks.ethereum).toBeDefined();
    expect(newState.networks.ethereum[4]).toBeUndefined();
  });
});
