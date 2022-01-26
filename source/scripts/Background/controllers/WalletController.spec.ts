import { FAKE_PASSWORD, FAKE_SEED_PHRASE } from 'constants/tests';

import store, { currentWalletState } from 'state/store';
import { initialState } from 'state/wallet';

import WalletController from './WalletController';

describe('WalletController.ts tests', () => {
  const {
    setWalletPassword,
    deleteWallet,
    switchWallet,
    checkPassword,
    importPhrase,
    logOut,
    generatePhrase,
    getPhrase,
    isLocked,
    password,
    encriptedPassword,
    mnemonic,
  } = WalletController();

  it('should delete walconst and check if walconst state back to initial state', () => {
    const password: any = FAKE_PASSWORD;

    setWalletPassword(password);
    deleteWallet(password);

    const currentState = currentWalletState;

    expect(currentState).toEqual(initialState);
  });

  it('should switch account and check if active account id has changed', () => {
    const newId = 1;

    switchWallet(newId);

    const { activeAccountId } = store.getState().wallet;

    expect(activeAccountId).toBe(newId);
  });

  it('should check if the password was encrypted', () => {
    const pwd = FAKE_PASSWORD;

    setWalletPassword(pwd);

    const isEncrypted = checkPassword(pwd);

    expect(isEncrypted).toBe(true);
  });

  it('should check if it is setting and encrypting correctly using SHA3', () => {
    const pwd = FAKE_PASSWORD;

    setWalletPassword(pwd);
  });

  it('should check if it is importing mnemonic correctly after validation', () => {
    const seedphrase = FAKE_SEED_PHRASE;

    const importedCorrectly = importPhrase(seedphrase);

    expect(importedCorrectly).toBe(true);
  });

  it('should logout', () => {
    const pwd = FAKE_PASSWORD;

    setWalletPassword(pwd);

    const seedphrase = FAKE_SEED_PHRASE;

    importPhrase(seedphrase);
    logOut();

    expect(password).toBe('');
    expect(encriptedPassword).toBe('');
    expect(mnemonic).toBe('');
  });

  it('should generate a mnemonic correctly', () => {
    generatePhrase();

    // @ts-ignore
    const wordCount = mnemonic.match(/(\w+)/g).length;

    expect(wordCount).toBe(12);
  });

  it('should check if it is getting mnemonic correctly according to password', () => {
    const pwd = FAKE_PASSWORD;

    setWalletPassword(pwd);
    generatePhrase();

    const result = getPhrase(pwd);

    expect(result).toBe(mnemonic);
  });

  it('should check if it is returning lock correctly', () => {
    const pwd = FAKE_PASSWORD;

    setWalletPassword(pwd);

    const seedphrase = FAKE_SEED_PHRASE;

    importPhrase(seedphrase);
    logOut();

    const Locked = isLocked();
    expect(Locked).toBe(true);
  });
});
