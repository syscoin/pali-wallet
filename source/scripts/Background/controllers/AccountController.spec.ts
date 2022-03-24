import CryptoJS from 'crypto-js';
import store from 'state/store';
import { createAccount } from 'state/wallet';
import { FAKE_ACCOUNT, FAKE_XPRV, FAKE_XPUB } from 'tests/unit/data/mocks';
import { IAccountState } from 'state/wallet/types';

import AccountController from './AccountController';
import WalletController from './WalletController';

describe('AccountController tests', () => {
  const { checkPassword, web3 } = WalletController();

  const {
    decryptAES,
    isValidSYSAddress,
    setNewAddress,
    getHoldingsData,
    setAutolockTimer,
    updateNetworkData,
    temporaryTransaction,
    getTemporaryTransaction,
    clearTemporaryTransaction,
    updateTemporaryTransaction,
    setNewXpub,
  } = AccountController({
    checkPassword: () => checkPassword('secret'),
    web3,
  });

  it('should encrypt and decrypt string correctly', () => {
    const value = 'test';

    const encrypt = CryptoJS.AES.encrypt(value, 'secret');
    const decrypt = decryptAES(encrypt.toString(), 'secret');

    expect(decrypt).toBe(value);
  });

  it('should return a sys address verification', () => {
    const invalidSysAddress = 'sys213ixks1mx';
    const value = isValidSYSAddress(invalidSysAddress, 'main');

    expect(value).toBeFalsy();
  });

  it('should set a new address account', () => {
    const newAddress = 'testAddress';

    setNewAddress(newAddress);

    const { accounts } = store.getState().wallet;

    expect(accounts[-1]?.address.main).toBe(newAddress);
  });

  it('should return holdings data', async () => {
    const result = await getHoldingsData();

    expect(result).toStrictEqual([]);
  });

  it('should set new autolock timer', () => {
    const newTime = 10;

    setAutolockTimer(newTime);

    const { timer } = store.getState().wallet;

    expect(timer).toBe(newTime);
  });

  it('should update networks info', () => {
    const newLabel = 'test';
    const newUrl = 'test.com';

    updateNetworkData({
      id: 'main',
      label: newLabel,
      chainId: 57,
      beUrl: newUrl,
      type: 'syscoin',
    });

    const { networks } = store.getState().wallet;

    expect(networks.main.label).toBe(newLabel);
  });

  it('should return temporary transaction info', () => {
    const transactionType = 'sendAsset';

    const result = getTemporaryTransaction(transactionType);

    expect(result).toBeNull();
  });

  it('should clear temporary transaction', () => {
    const transactionType = 'mintNFT';

    clearTemporaryTransaction(transactionType);

    expect(temporaryTransaction[transactionType]).toBeNull();
  });

  it('should update temporary transaction data', () => {
    const transactionType = 'sendAsset';
    const mockJson = {
      fromConnectedAccount: 'sys1qydmw8wrtl4mvk6he65qqrq8ml9f6eyyl9tasax',
      toAddress: 'sys1qhg7mfvds68kaz8xanssknd730x5lhceu2ner9k',
      amount: 123,
      fee: 0.00001,
      token: null,
      isToken: false,
      rbf: true,
    };

    updateTemporaryTransaction({
      tx: mockJson,
      type: transactionType,
    });

    expect(temporaryTransaction[transactionType]).toEqual(mockJson);
  });

  it('should create new xpub', () => {
    const newXpub = FAKE_XPUB;
    const xprv = FAKE_XPRV;
    const payload: IAccountState = FAKE_ACCOUNT;

    store.dispatch(createAccount(payload));
    // FAKE ACCOUNT ID = 15
    setNewXpub(15, newXpub, xprv, '123');

    const { accounts } = store.getState().wallet;

    // INDEX VALUE = 0
    const account0 = accounts[0].xpub;
    expect(account0).toBe(newXpub);
  });
});
