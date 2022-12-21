import {
  CUSTOM_UTXO_RPC_VALID_PAYLOAD,
  CUSTOM_WEB3_ID_INVALID_PAYLOAD,
  VALID_INITIAL_CUSTOM_RPC,
  VALID_GET_NETWORK_DATA_RESPONSE,
  CUSTOM_WEB3_URL_INVALID_PAYLOAD,
  NEW_VALID_CHAIN_ID,
  CUSTOM_WEB3_RPC_VALID_PAYLOAD,
  VALID_GET_WEB3_RPC_RESPONSE,
  VALID_GET_UTXO_RPC_RESPONSE,
  MOCK_PASSWORD,
  MOCK_SEED_PHRASE,
} from '../mocks';
import MainController from 'scripts/Background/controllers/MainController';
import store from 'state/store';
import { initialState } from 'state/vault';

jest.useFakeTimers('legacy');

// todo: refactor
describe('main controller tests', () => {
  beforeAll((done) => {
    done();
  });

  const controller = MainController();

  // // //* setPrices
  it('should set autolock timer', () => {
    const payload = 8;

    controller.setAutolockTimer(payload);

    const { timer } = store.getState().vault;

    expect(timer).toEqual(payload);
  });

  it('should return network data', async () => {
    const data = await controller.getNetworkData();

    expect(data).toStrictEqual(VALID_GET_NETWORK_DATA_RESPONSE);
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

  it('should edit a custom rpc', async () => {
    const edited = await controller.editCustomRpc(
      CUSTOM_WEB3_RPC_VALID_PAYLOAD,
      VALID_INITIAL_CUSTOM_RPC
    );

    const { networks } = store.getState().vault;

    expect(networks.ethereum[NEW_VALID_CHAIN_ID]).toStrictEqual(edited);
  });

  it('should return the recommended gas fee according to utxo network', async () => {
    const fee = await controller.getRecommendedFee();

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
  });

  it('should forget wallet', async () => {
    controller.forgetWallet(MOCK_PASSWORD);

    expect(store.getState().vault).toStrictEqual(initialState);
  });

  it('should lock the wallet', () => {
    controller.lock();

    expect(store.getState().vault.lastLogin).toBeGreaterThan(0);
  });

  it('should add a new account', async () => {
    // todo assert MOCK_ACCOUNT.label
  });

  it('should set new infos for an account', async () => {
    // todo
  });

  it('should set an active network', async () => {
    // todo
  });

  it('should remove a network', () => {
    // todo
  });

  it('should import wallet', async () => {
    // todo assert MOCK_ACCOUNT
    // assert MOCK_XPRV
    // use MOCK_SEED_PHRASE
  });
});
