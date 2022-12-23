import { ethers } from 'ethers';

import { INetwork, isValidSYSAddress } from '@pollum-io/sysweb3-utils';

import {
  CUSTOM_UTXO_RPC_VALID_PAYLOAD,
  CUSTOM_WEB3_ID_INVALID_PAYLOAD,
  VALID_INITIAL_CUSTOM_RPC,
  VALID_NETWORK_VERSION_UTXO_RESPONSE,
  VALID_NETWORK_VERSION_WEB3_RESPONSE,
  CUSTOM_WEB3_URL_INVALID_PAYLOAD,
  NEW_VALID_CHAIN_ID,
  CUSTOM_WEB3_RPC_VALID_PAYLOAD,
  VALID_GET_WEB3_RPC_RESPONSE,
  VALID_GET_UTXO_RPC_RESPONSE,
  MOCK_PASSWORD,
  MOCK_SEED_PHRASE,
  MOCK_ACCOUNT,
} from '../mocks';
import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
import reducer, { forgetWallet } from 'state/vault';
import { initialState } from 'state/vault';

jest.useFakeTimers('legacy');

// todo: refactor
// todo: close open handles and remove --forceExit
// todo: create initialize methods for wallet creation
describe('main controller tests', () => {
  const controller = MainController();

  beforeAll((done) => {
    reducer(initialState, forgetWallet());
    done();
  });

  //* setPrices
  it('should set autolock timer', () => {
    const payload = 8;

    controller.setAutolockTimer(payload);

    const { timer } = store.getState().vault;

    expect(timer).toEqual(payload);
  });

  it('should return network data', async () => {
    const data = await controller.getNetworkData();

    expect(data).toStrictEqual(VALID_NETWORK_VERSION_UTXO_RESPONSE);
  });

  it('should get utxo rpc', async () => {
    const data = await controller.getRpc(CUSTOM_UTXO_RPC_VALID_PAYLOAD);

    expect(data).toStrictEqual(VALID_GET_UTXO_RPC_RESPONSE);
  });

  // will be removed after we publish the new sysweb3 network version
  it('should get eth rpc', async () => {
    const data = await controller.getRpc(CUSTOM_WEB3_RPC_VALID_PAYLOAD);

    expect(data).toStrictEqual(VALID_GET_WEB3_RPC_RESPONSE);
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

  it('should throw an error if chain id is invalid for given url', async () => {
    await expect(
      controller.editCustomRpc(
        CUSTOM_WEB3_ID_INVALID_PAYLOAD,
        VALID_INITIAL_CUSTOM_RPC
      )
    ).rejects.toThrow(
      new Error('RPC invalid. Endpoint returned a different Chain ID.')
    );
  });

  it('should throw an error if url is invalid for given chain id', async () => {
    // this can take some time because it is trying to fetch an invalid rpc, but this should not exceed timeout of 5000 ms
    await expect(
      controller.editCustomRpc(
        CUSTOM_WEB3_URL_INVALID_PAYLOAD,
        VALID_INITIAL_CUSTOM_RPC
      )
    ).rejects.toThrowError();
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

  it('should return the recommended gas fee according to utxo network', () => {
    const fee = controller.getRecommendedFee();

    expect(fee).toBeCloseTo(0.00002);
    expect(typeof fee).toBe('number');
    expect(fee).toBeLessThan(1);
    expect(fee).toBeGreaterThanOrEqual(0);
  });

  /** wallet methods */
  it('should check password', () => {
    controller.createSeed();
    controller.setWalletPassword(MOCK_PASSWORD);

    expect(controller.checkPassword(MOCK_PASSWORD)).toBeTruthy();
    controller.forgetWallet(MOCK_PASSWORD);
  });

  it('should replace the created mnemonic for an imported mnemonic', () => {
    controller.forgetWallet(MOCK_PASSWORD);
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

  it('should create a new wallet', async () => {
    controller.forgetWallet(MOCK_PASSWORD);
    controller.createSeed();

    const newAccount = await controller.createWallet(MOCK_PASSWORD);

    const {
      accounts,
      activeAccount,
      isPendingBalances,
      lastLogin,
      encryptedMnemonic,
    } = store.getState().vault;

    expect(accounts).toStrictEqual({
      [newAccount.id]: newAccount,
    });
    expect(activeAccount).toStrictEqual(newAccount);
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
  });

  // todo: check performance
  it('should add a new account and set it as the active one', async () => {
    controller.forgetWallet(MOCK_PASSWORD);
    controller.createSeed();

    await controller.createWallet(MOCK_PASSWORD);

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

    expect(currentActiveAccount.id).toStrictEqual(1);

    controller.setAccount(0);

    const { activeAccount } = store.getState().vault;

    expect(activeAccount.id).toStrictEqual(0);
    expect(activeAccount.id).not.toBe(1);
    controller.forgetWallet(MOCK_PASSWORD);
  });

  // todo: check performance
  it('should throw an error if switch network fails', async () => {
    controller.forgetWallet(MOCK_PASSWORD);
    controller.createSeed();

    await controller.createWallet(MOCK_PASSWORD);

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
    controller.forgetWallet(MOCK_PASSWORD);
  });

  // todo: check performance
  it('should set an eth network as the active network and update the active account', async () => {
    controller.forgetWallet(MOCK_PASSWORD);
    controller.createSeed();

    await controller.createWallet(MOCK_PASSWORD);

    const { activeNetwork: currentActiveNetwork, networks } =
      store.getState().vault;

    expect(currentActiveNetwork.chainId).toBe(
      initialState.activeNetwork.chainId
    );

    const payload = networks.ethereum[1];

    const response = await controller.setActiveNetwork(payload, 'ethereum');

    expect(response).toStrictEqual(VALID_NETWORK_VERSION_WEB3_RESPONSE);

    const { activeNetwork, activeAccount, isBitcoinBased, isPendingBalances } =
      store.getState().vault;

    const addressIsValid = ethers.utils.isAddress(activeAccount.address);

    expect(activeNetwork).toStrictEqual(payload);
    expect(addressIsValid).toBeTruthy();
    expect(isBitcoinBased).toBeFalsy();
    expect(isPendingBalances).toBeFalsy();
    controller.forgetWallet(MOCK_PASSWORD);
  });

  // todo: check performance
  it('should set an utxo network as the active network and update the active account', async () => {
    controller.forgetWallet(MOCK_PASSWORD);
    controller.createSeed();

    await controller.createWallet(MOCK_PASSWORD);

    const { activeNetwork: currentActiveNetwork, networks } =
      store.getState().vault;

    expect(currentActiveNetwork.chainId).toBe(
      initialState.activeNetwork.chainId
    );

    const payload = networks.syscoin[5700];

    const response = await controller.setActiveNetwork(payload, 'syscoin');

    // network version and chain id of the provider will keep the same since we are using an utxo network and not a web3 one
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
    controller.forgetWallet(MOCK_PASSWORD);
  });

  it('should remove a network', () => {
    controller.removeKeyringNetwork('ethereum', 10);

    expect(store.getState().vault.networks[10]).toBeUndefined();
  });

  it('should unlock the wallet', async () => {
    const {
      lastLogin: currentLastLogin,
      activeAccount: currentActiveAccount,
      activeNetwork: currentActiveNetwork,
    } = store.getState().vault;

    await controller.unlock(MOCK_PASSWORD);

    const { lastLogin, activeAccount, activeNetwork } = store.getState().vault;

    expect(currentLastLogin).toBeLessThan(lastLogin);
    expect(activeAccount).toStrictEqual(currentActiveAccount);
    expect(activeNetwork).toStrictEqual(currentActiveNetwork);
  });

  it('should import wallet', async () => {
    // todo assert MOCK_ACCOUNT
    // assert MOCK_XPRV
    // use MOCK_SEED_PHRASE
  });

  it('should create a new wallet and login using a different seed', () => {
    // todo
  });

  it('should import a new wallet and login using a different seed', () => {
    // todo
  });

  it('should create a new wallet, forget it and create a new one using a different seed', () => {
    // todo
  });

  it('should create a new wallet, forget it and import a new one using a different seed', () => {
    // todo
  });

  it('should create a new wallet, forget it and import a new one using the same seed', () => {
    // todo
  });
});
