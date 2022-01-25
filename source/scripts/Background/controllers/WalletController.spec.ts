import { FAKE_PASSWORD } from 'constants/tests';

import { currentWalletState } from 'state/store';
import { initialState } from 'state/wallet';

import WalletController from './WalletController';

describe('WalletController.ts tests', () => {
  const { setWalletPassword, deleteWallet } = WalletController();

  it('should delete wallet and check if wallet state back to initial state', () => {
    const password: any = FAKE_PASSWORD;

    setWalletPassword(password);
    deleteWallet(password);

    const currentState = currentWalletState;

    expect(currentState).toEqual(initialState);
  });

  // it('should switch account and check if active account id has changed', () => {
  //   const newId = 1;
  //   switchWallet(newId);
  //   const { activeAccountId } = store.getState().wallet;
  //   expect(activeAccountId).toBe(newId);
  // });

  // it('should check if the password was encrypted', () => {
  //   let pwd = CONSTANTS.PASSWORD;
  //   setWalletPassword(pwd);
  //   const isEncrypted = checkPassword(pwd);
  //   expect(isEncrypted).toBe(true);
  // });

  // it('should check if it is setting and encrypting correctly using SHA3', () => {
  //   let pwd = CONSTANTS.PASSWORD;
  //   setWalletPassword(pwd);
  // });

  // it('should check if it is importing mnemonic correctly after validation', () => {
  //   let seedphrase = CONSTANTS.IMPORT_WALLET;
  //   const importedCorrectly = importPhrase(seedphrase);
  //   expect(importedCorrectly).toBe(true);
  // });

  // it('should logout', () => {
  //   let pwd = CONSTANTS.PASSWORD;
  //   setWalletPassword(pwd);
  //   let seedphrase = CONSTANTS.IMPORT_WALLET;
  //   importPhrase(seedphrase);
  //   logOut();
  //   expect(password).toBe('');
  //   expect(encriptedPassword).toBe('');
  //   expect(mnemonic).toBe('');
  // });

  // it('should generate a mnemonic correctly', () => {
  //   generatePhrase();

  //   var wordCount = mnemonic.match(/(\w+)/g).length;
  //   expect(wordCount).toBe(12);
  // });

  // it('should check if it is getting mnemonic correctly according to password', () => {
  //   let pwd = CONSTANTS.PASSWORD;
  //   setWalletPassword(pwd);
  //   generatePhrase();
  //   const result = getPhrase(pwd);
  //   expect(result).toBe(mnemonic);
  // });

  // it('should check if it is returning lock correctly', () => {
  //   //need to check hdsigner
  //   let pwd = CONSTANTS.PASSWORD;
  //   setWalletPassword(pwd);
  //   let seedphrase = CONSTANTS.IMPORT_WALLET;
  //   importPhrase(seedphrase);
  //   logOut();
  //   const Locked = isLocked();
  //   expect(Locked).toBe(true);
  // });
});
