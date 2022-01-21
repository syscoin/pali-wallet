import CryptoJS from 'crypto-js';

import AccountController from './AccountController';
import WalletController from './WalletController';

describe('AccountController tests', () => {
  const { checkPassword } = WalletController();

  const { decryptAES } = AccountController({
    checkPassword: () => checkPassword('secret'),
  });

  it('should encrypt and decrypt string correctly', () => {
    const value = 'test';

    const encrypt = CryptoJS.AES.encrypt(value, 'secret');
    const decrypt = decryptAES(encrypt.toString(), 'secret');

    expect(decrypt).toBe(value);
  });

  // it('should return a decrypt string', () => {
  //   const value = 'test';
  //   const encrypt = CryptoJS.AES.encrypt(value, 'test123');
  //   const decrypt = decryptAES(encrypt.toString(), 'test123');
  //   expect(decrypt).toBe(value);
  // });

  // it('should return a sys address verification', () => {
  //   const invalidSysAddress = 'sys213ixks1mx';
  //   const value = isValidSYSAddress(invalidSysAddress, 'main');
  //   expect(value).toBeFalsy();
  // });

  // it('should set a new address account', () => {
  //   const newAddress = 'testAddress';
  //   setNewAddress(newAddress);
  //   const { accounts } = store.getState().wallet;
  //   expect(accounts[0]?.address.main).toBe(newAddress);
  // });

  // it('should return holdings data', async () => {
  //   const result = await getHoldingsData();
  //   expect(result).toStrictEqual([]);
  // });

  // it('should set new autolock timer', () => {
  //   const newTime = 10;
  //   setAutolockTimer(newTime);
  //   const { timer } = store.getState().wallet;
  //   expect(timer).toBe(newTime);
  // });

  // it('should update networks info', () => {
  //   const newLabel = 'test';
  //   const newUrl = 'test.com';
  //   updateNetworkData({ id: 'main', label: newLabel, beUrl: newUrl });
  //   const { networks } = store.getState().wallet;
  //   expect(networks.main.label).toBe(newLabel);
  // });

  // it('should update transaction data', () => {
  //   const txId =
  //     '89f20ae3ba21792b60dc32007b273dde4ffa7b9c389bbb688772974fbeb38962';
  //   updateTransactionData(txId);
  // });

  // it('should return temporary transaction info', () => {
  //   const transactionType = 'sendAsset';
  //   const result = getTemporaryTransaction(transactionType);
  //   expect(result).toBeNull();
  // });

  // it('should clear temporary transaction', () => {
  //   const transactionType = 'sendAsset';
  //   const result = clearTemporaryTransaction(transactionType);
  //   expect(result).toBeNull();
  // });

  // it('should update temporary transaction data', () => {
  //   const transactionType = 'newNFT';
  //   const mockJson = {
  //     fromConnectedAccount: 'test',
  //     toAddress: 'addressTest',
  //     amount: 123,
  //     fee: 123,
  //     token: 'ADA',
  //     isToken: false,
  //     rbf: '',
  //   };
  //   updateTemporaryTransaction({
  //     tx: mockJson,
  //     type: transactionType,
  //   });
  //   expect(temporaryTransaction.newNFT).toStrictEqual(mockJson);
  // });

  // it('should create new xpub', () => {
  //   const newXpub = 'test';
  //   const xprv = 'testXprv';
  //   setNewXpub(0, newXpub, xprv, '123');
  //   const { accounts } = store.getState().wallet;
  //   const account0 = accounts[0].xpub;
  //   expect(account0).toBe(newXpub);
  // });
});
