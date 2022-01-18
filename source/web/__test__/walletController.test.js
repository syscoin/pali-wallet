// const sys = require('syscoinjs-lib');
const CryptoJS = require('crypto-js');
const { initialMockState, SYS_NETWORK } = require('../staticState/store');
const { defaultMockState } = require('../staticState/defaultStore');
const { default: store } = require('../dynamicState/store');
const CONSTANTS = require('../e2e/constants');
import { check } from 'yargs';
import { generateMnemonic, validateMnemonic } from 'bip39';
//const { default: axios } = require('axios');
import {
  deleteWallet as deleteWalletState,
  changeAccountActiveId,
  //changeActiveNetwork,
  //updateStatus,
  setEncriptedMnemonic,
  //updateSwitchNetwork,
} from '../dynamicState/wallet';
//import { is } from "core-js/core/object";

let password = '';
let encriptedPassword = '';
let mnemonic = '';
let HDsigner = null;
let sjs = null;

const logOut = () => {
  password = '';
  encriptedPassword = '';
  mnemonic = '';
};

const switchWallet = (id) => {
  store.dispatch(changeAccountActiveId(id));
};

const setWalletPassword = (pwd) => {
  password = pwd;
  encriptedPassword = CryptoJS.SHA3(pwd).toString();
};

const checkPassword = (pwd) => {
  if (encriptedPassword === CryptoJS.SHA3(pwd).toString()) {
    return true;
  }

  return encriptedPassword === pwd;
};

const deleteWallet = (pwd) => {
  if (checkPassword(pwd)) {
    password = '';
    encriptedPassword = '';
    mnemonic = '';
    HDsigner = null;
    sjs = null;
    store.dispatch(deleteWalletState());
  }
};

const importPhrase = (seedphrase) => {
  if (validateMnemonic(seedphrase)) {
    mnemonic = seedphrase;

    return true;
  }

  return false;
};

const retrieveEncriptedMnemonic = () => {
  // not encrypted for now but we got to retrieve
  const { encriptedMnemonic } = store.getState().wallet;

  return encriptedMnemonic !== '' ? encriptedMnemonic : null;
};

const generatePhrase = () => {
  if (retrieveEncriptedMnemonic()) {
    return null;
  }

  if (!mnemonic) mnemonic = generateMnemonic();

  return mnemonic;
};

const getPhrase = (pwd) => (checkPassword(pwd) ? mnemonic : null);

const addNewAccount = (label) =>
  account.subscribeAccount(encriptedPassword, false, null, label, false);

const isLocked = () => !encriptedPassword || !HDsigner;

describe('walletController tests', () => {
  it('should switch account and check if active account id has changed', () => {
    const newId = 1;
    switchWallet(newId);
    const { activeAccountId } = store.getState().wallet;
    expect(activeAccountId).toBe(newId);
  });

  it('should check if the password was encrypted', () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    const isEncrypted = checkPassword(pwd);
    expect(isEncrypted).toBe(true);
  });

  it('should check if it is setting and encrypting correctly using SHA3', () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
  });

  it('should check if it is importing mnemonic correctly after validation', () => {
    let seedphrase = CONSTANTS.IMPORT_WALLET;
    const importedCorrectly = importPhrase(seedphrase);
    expect(importedCorrectly).toBe(true);
  });

  it('should delete wallet and check if wallet state back to initial state', () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    deleteWallet(pwd);
    const currentState = store.getState().wallet;
    expect(currentState).toStrictEqual(defaultMockState);
  });

  it('should logout', () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    let seedphrase = CONSTANTS.IMPORT_WALLET;
    importPhrase(seedphrase);
    logOut();
    expect(password).toBe('');
    expect(encriptedPassword).toBe('');
    expect(mnemonic).toBe('');
  });

  it('should generate a mnemonic correctly', () => {
    generatePhrase();

    var wordCount = mnemonic.match(/(\w+)/g).length;
    expect(wordCount).toBe(12);
  });

  it('should check if it is getting mnemonic correctly according to password', () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    generatePhrase();
    const result = getPhrase(pwd);
    expect(result).toBe(mnemonic);
  });

  /*it("should check if it is returning encrypted mnemonic correctly", () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    generatePhrase();
    const encryptedMnemonic = CryptoJS.AES.encrypt(mnemonic, password);
    //store.dispatch(setEncriptedMnemonic(encryptedMnemonic));
    const { encriptedMnemonic } = store.getState().wallet;
    expect(encryptedMnemonic).toBe(encriptedMnemonic);
  });*/

  /*it("should check if it is adding a new account correctly using encrypted mnemonic", () => {
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    generatePhrase();
    addNewAccount("test account");
    const { accounts } = store.getState().wallet;
    console.log(accounts);
  });*/

  it('should check if it is returning lock correctly', () => {
    //need to check hdsigner
    let pwd = CONSTANTS.PASSWORD;
    setWalletPassword(pwd);
    let seedphrase = CONSTANTS.IMPORT_WALLET;
    importPhrase(seedphrase);
    logOut();
    const Locked = isLocked();
    expect(Locked).toBe(true);
  });
});
