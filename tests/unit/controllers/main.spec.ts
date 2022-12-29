import { ethers } from 'ethers';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';
import { INetwork, isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import { getWalletMockState } from '../../initializeWalletTests';
import {
  CUSTOM_UTXO_RPC_VALID_PAYLOAD,
  VALID_INITIAL_CUSTOM_RPC,
  NEW_VALID_CHAIN_ID,
  CUSTOM_WEB3_RPC_VALID_PAYLOAD,
  MOCK_PASSWORD,
  MOCK_SEED_PHRASE,
  MOCK_ACCOUNT,
  VALID_NETWORK_VERSION_UTXO_RESPONSE,
  VALID_NETWORK_VERSION_WEB3_RESPONSE,
} from '../../mocks';
import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
import reducer, { forgetWallet } from 'state/vault';
import { initialState } from 'state/vault';

jest.useFakeTimers('legacy');

// todo: close open handles and remove --forceExit
describe('general, mnemonic and wallet not related tests', () => {
  const controller = MainController();

  beforeEach(() => {
    reducer(initialState, forgetWallet());
  });

  it('should return the recommended gas fee according to utxo network', () => {
    const fee = controller.getRecommendedFee();

    expect(fee).toBeCloseTo(0.00002);
    expect(typeof fee).toBe('number');
    expect(fee).toBeLessThan(1);
    expect(fee).toBeGreaterThanOrEqual(0);
  });

  it('should remove a network', () => {
    controller.removeKeyringNetwork('ethereum', 10);

    expect(store.getState().vault.networks[10]).toBeUndefined();
  });

  /** wallet methods */
  it('should check password', () => {
    controller.createSeed();
    controller.setWalletPassword(MOCK_PASSWORD);

    expect(controller.checkPassword(MOCK_PASSWORD)).toBeTruthy();
  });

  it('should replace the created mnemonic for an imported mnemonic', () => {
    controller.createSeed();

    const oldEncryptedMnemonic = controller.getEncryptedMnemonic();

    controller.setWalletPassword(MOCK_PASSWORD);
    controller.validateSeed(MOCK_SEED_PHRASE);

    const newEncryptedMnemonic = controller.getEncryptedMnemonic();

    expect(controller.checkPassword(MOCK_PASSWORD)).toBeTruthy();
    expect(oldEncryptedMnemonic).not.toBe(newEncryptedMnemonic);
  });

  it('should set a created mnemonic', () => {
    controller.forgetWallet(MOCK_PASSWORD);

    const oldEncryptedMnemonic = controller.getEncryptedMnemonic();

    expect(oldEncryptedMnemonic).toBe('');

    controller.createSeed();
    controller.setWalletPassword(MOCK_PASSWORD);

    const newEncryptedMnemonic = controller.getEncryptedMnemonic();

    expect(newEncryptedMnemonic).toBeDefined();
  });

  it('should add a custom sys rpc', async () => {
    const { chainId } = CUSTOM_UTXO_RPC_VALID_PAYLOAD;

    const data = await controller.addCustomRpc(CUSTOM_UTXO_RPC_VALID_PAYLOAD);

    const { networks } = store.getState().vault;

    expect(networks.syscoin[chainId]).toBeDefined();
    expect(networks.syscoin[chainId]).toStrictEqual(data);
  });

  it('should add a custom eth rpc', async () => {
    const { chainId } = CUSTOM_WEB3_RPC_VALID_PAYLOAD;

    const data = await controller.addCustomRpc(CUSTOM_WEB3_RPC_VALID_PAYLOAD);

    const { networks } = store.getState().vault;

    expect(networks.ethereum[chainId]).toBeDefined();
    expect(networks.ethereum[chainId]).toStrictEqual(data);
  });

  // todo: check performance
  it('should edit a custom rpc', async () => {
    const edited = await controller.editCustomRpc(
      CUSTOM_WEB3_RPC_VALID_PAYLOAD,
      VALID_INITIAL_CUSTOM_RPC
    );

    const { networks } = store.getState().vault;

    expect(networks.ethereum[NEW_VALID_CHAIN_ID]).toStrictEqual(edited);
  });
});

let createdAccount = {} as IKeyringAccountState;

describe('wallet creation tests', () => {
  const { initializeWallet } = getWalletMockState();
  const controller = MainController();

  beforeEach(async () => {
    const account = await initializeWallet();

    createdAccount = account;
  });

  it('should create a new wallet', async () => {
    const {
      accounts,
      activeAccount,
      isPendingBalances,
      lastLogin,
      encryptedMnemonic,
    } = store.getState().vault;

    expect(accounts).toStrictEqual({
      [createdAccount.id]: createdAccount,
    });
    expect(activeAccount).toStrictEqual(createdAccount);
    expect(isPendingBalances).toBeFalsy();
    expect(lastLogin).toBeGreaterThan(0);
    expect(encryptedMnemonic).toBeDefined();
    controller.forgetWallet(MOCK_PASSWORD);
  });

  it('should forget wallet', async () => {
    controller.forgetWallet(MOCK_PASSWORD);

    expect(store.getState().vault).toStrictEqual(initialState);
  });

  it('should lock the wallet', () => {
    controller.lock();

    expect(store.getState().vault.lastLogin).toBeGreaterThan(0);
    expect(controller.isUnlocked()).toBeFalsy();
  });

  // todo: check performance
  it('should add a new account and set it as the active one', async () => {
    const { accounts: accountsBeforeAccountCreation, activeAccount } =
      store.getState().vault;
    const { length: lengthBeforeAccountCreation } = Object.values(
      accountsBeforeAccountCreation
    );

    const account = await controller.createAccount(
      `test ${MOCK_ACCOUNT.label}`
    );

    const { accounts } = store.getState().vault;

    const { length } = Object.values(store.getState().vault.accounts);

    expect(length).toBe(lengthBeforeAccountCreation + 1);
    expect(accounts[account.id]).toBeDefined();
    expect(accounts[account.id]).toStrictEqual(account);
    expect(activeAccount.id).toBe(0);
  });

  it('should set the active account', () => {
    const { activeAccount: currentActiveAccount } = store.getState().vault;

    expect(currentActiveAccount.id).toStrictEqual(0);

    controller.setAccount(1);

    const { activeAccount } = store.getState().vault;

    expect(activeAccount.id).toStrictEqual(1);
    expect(activeAccount.id).not.toBe(0);
    controller.forgetWallet(MOCK_PASSWORD);
  });

  // todo: check performance
  it('should throw an error if switch network fails', async () => {
    const { activeNetwork: currentActiveNetwork } = store.getState().vault;

    expect(currentActiveNetwork.chainId).toBe(
      initialState.activeNetwork.chainId
    );

    // throw an error if no network is passed
    await expect(
      controller.setActiveNetwork(null, 'ethereum')
    ).rejects.toThrowError('Missing required network info.');

    // throw an error if invalid network for ethereum is passed
    await expect(
      controller.setActiveNetwork(
        { url: 'https://blockbook-litecoin.binancechain.io/' } as INetwork,
        'ethereum'
      )
    ).rejects.toThrowError();

    const {
      activeNetwork,
      activeAccount,
      isBitcoinBased,
      isPendingBalances,
      error,
    } = store.getState().vault;

    const addressIsValid = ethers.utils.isAddress(activeAccount.address);

    expect(activeNetwork).toStrictEqual(currentActiveNetwork);
    expect(addressIsValid).toBeFalsy();
    expect(isBitcoinBased).toBeTruthy();
    expect(error).toBeTruthy();
    expect(isPendingBalances).toBeFalsy();
  });

  // todo: check performance
  it('should set an eth network as the active network and update the active account', async () => {
    const { activeNetwork: currentActiveNetwork, networks } =
      store.getState().vault;

    expect(currentActiveNetwork.chainId).toBe(
      initialState.activeNetwork.chainId
    );

    const payload = networks.ethereum[137];

    await controller.setActiveNetwork(payload, 'ethereum');

    const { activeNetwork, activeAccount, isBitcoinBased, isPendingBalances } =
      store.getState().vault;

    const addressIsValid = ethers.utils.isAddress(activeAccount.address);

    expect(activeNetwork).toStrictEqual(payload);
    expect(addressIsValid).toBeTruthy();
    expect(isBitcoinBased).toBeFalsy();
    expect(isPendingBalances).toBeFalsy();
  });

  // todo: check performance
  it('should set an utxo network as the active network and update the active account', async () => {
    const { activeNetwork: currentActiveNetwork, networks } =
      store.getState().vault;

    const payload = networks.syscoin[5700];

    expect(currentActiveNetwork.chainId).not.toBe(
      initialState.activeNetwork.chainId
    );

    const response = await controller.setActiveNetwork(payload, 'syscoin');

    expect(response).toStrictEqual(VALID_NETWORK_VERSION_WEB3_RESPONSE);

    const { activeNetwork, activeAccount, isBitcoinBased, isPendingBalances } =
      store.getState().vault;

    const isWeb3Address = ethers.utils.isAddress(activeAccount.address);

    const isValidUtxoAddress = isValidSYSAddress(
      activeAccount.address,
      payload
    );

    expect(activeNetwork).toStrictEqual(payload);
    expect(isWeb3Address).toBeFalsy();
    expect(isValidUtxoAddress).toBeTruthy();
    expect(isBitcoinBased).toBeTruthy();
    expect(isPendingBalances).toBeFalsy();
  });

  it('should unlock the wallet', async () => {
    const {
      lastLogin: currentLastLogin,
      activeAccount: currentActiveAccount,
      activeNetwork: currentActiveNetwork,
    } = store.getState().vault;

    await controller.unlock(MOCK_PASSWORD);

    const { lastLogin, activeAccount, activeNetwork } = store.getState().vault;

    expect(controller.isUnlocked()).toBeTruthy();
    expect(currentLastLogin).toBeLessThan(lastLogin);
    expect(activeAccount).toStrictEqual(currentActiveAccount);
    expect(activeNetwork).toStrictEqual(currentActiveNetwork);
  });

  it('should unlock / forget / import using a different seed', async () => {
    controller.lock();

    expect(controller.isUnlocked()).toBeFalsy();
    expect(store.getState().vault.lastLogin).toBeGreaterThan(0);

    controller.forgetWallet(MOCK_PASSWORD);
    controller.validateSeed(MOCK_SEED_PHRASE);

    const acc = await controller.createWallet(MOCK_PASSWORD);

    const { activeAccount, activeNetwork } = store.getState().vault;

    expect(activeAccount.address).toStrictEqual(acc.address);
    expect(activeNetwork).toStrictEqual(initialState.activeNetwork);
  });
});

describe('wallet related tests', () => {
  const controller = MainController();

  // todo: check performance
  it('should import wallet', async () => {
    controller.validateSeed(MOCK_SEED_PHRASE);

    const account = await controller.createWallet(MOCK_PASSWORD);

    expect(Object.values(store.getState().vault.accounts).length).toBe(1);
    expect(account.xpub).toStrictEqual(MOCK_ACCOUNT.xpub);
    expect(account.address).toStrictEqual(MOCK_ACCOUNT.address);
  });

  it('should import a new wallet and login using a different seed', async () => {
    controller.lock();

    expect(controller.isUnlocked()).toBeFalsy();
    expect(store.getState().vault.lastLogin).toBeGreaterThan(0);

    const { activeNetwork: currentActiveNetwork } = store.getState().vault;

    controller.forgetWallet(MOCK_PASSWORD);
    controller.validateSeed(MOCK_SEED_PHRASE);

    const acc = await controller.createWallet(MOCK_PASSWORD);

    const { activeAccount, activeNetwork } = store.getState().vault;

    expect(activeAccount.address).toStrictEqual(acc.address);
    expect(activeNetwork).toStrictEqual(currentActiveNetwork);
  });
});
