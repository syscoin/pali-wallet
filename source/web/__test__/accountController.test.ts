import CryptoJS from 'crypto-js';
import { bech32 } from 'bech32';

import store from '../dynamicState/store';
import {
  updateTransactions,
  updateAccountAddress,
  setTimer,
  updateNetwork,
  updateAccountXpub,
} from '../dynamicState/wallet';
import { Transaction } from '../../types/transactions';

const getConnectedAccount = () => {
  const { accounts, tabs } = store.getState().wallet;
  const { currentURL } = tabs;
  return accounts.find((account) =>
    account.connectedTo.find((url) => url === new URL(currentURL).host)
  );
};

const decryptAES = (encryptedString, key) =>
  CryptoJS.AES.decrypt(encryptedString, key).toString(CryptoJS.enc.Utf8);

const isValidSYSAddress = (address, network, verification = true) => {
  let resAddress;
  let encode;
  if (!verification) {
    return true;
  }

  if (address && typeof address === 'string') {
    try {
      resAddress = bech32.decode(address);

      if (network === 'main' && resAddress.prefix === 'sys') {
        encode = bech32.encode(resAddress.prefix, resAddress.words);

        return encode === address.toLowerCase();
      }

      if (network === 'testnet' && resAddress.prefix === 'tsys') {
        encode = bech32.encode(resAddress.prefix, resAddress.words);

        return encode === address.toLowerCase();
      }
    } catch (error) {
      return false;
    }
  }

  return false;
};

const setNewAddress = (addr) => {
  const { activeAccountId } = store.getState().wallet;

  store.dispatch(
    updateAccountAddress({
      id: activeAccountId,
      address: { main: addr },
    })
  );

  return true;
};

const getHoldingsData = async () => {
  const { walletTokens } = store.getState().wallet;

  if (walletTokens) {
    const connectedAccountId = walletTokens.findIndex(
      (accountTokens) => accountTokens.accountId === getConnectedAccount().id
    );

    if (connectedAccountId > -1) {
      return walletTokens[connectedAccountId].holdings;
    }
  }

  return [];
};

const setAutolockTimer = (minutes) => {
  store.dispatch(setTimer(minutes));
};

const updateNetworkData = ({ id, label, beUrl }) => {
  store.dispatch(
    updateNetwork({
      id,
      label,
      beUrl,
    })
  );
};

const coventPendingType = (txid) => ({
  txid,
  value: 0,
  confirmations: 0,
  fees: 0,
  blockTime: Date.now() / 1e3,
});

const updateTransactionData = (txinfo: any) => {
  let globalAccount: any;
  let tokenType: any;
  const transactionItem =
    store.getState().wallet.temporaryTransactionState.type === 'sendAsset';

  let transactions: Transaction[] = [];

  if (transactionItem && globalAccount) {
    transactions = globalAccount?.transactions;
  }

  if (!transactionItem && getConnectedAccount()) {
    transactions = getConnectedAccount().transactions;
  }

  store.dispatch(
    updateTransactions({
      id: transactionItem
        ? Number(globalAccount?.id)
        : Number(getConnectedAccount().id),
      txs: [coventPendingType(txinfo), tokenType, ...transactions],
    })
  );
};

const temporaryTransaction = {
  newAsset: null,
  mintAsset: null,
  newNFT: null,
  updateAsset: null,
  transferAsset: null,
  sendAsset: null,
  signPSBT: null,
  signAndSendPSBT: null,
  mintNFT: null,
};

const getTemporaryTransaction = (type) => temporaryTransaction[type];

const clearTemporaryTransaction = (item: string) =>
  (temporaryTransaction[item] = null);
const updateTemporaryTransaction = ({ tx, type }) => {
  temporaryTransaction[type] = { ...tx };
};

const setNewXpub = (id: number, xpub: string, xprv: string, key: string) => {
  store.dispatch(
    updateAccountXpub({
      id,
      xpub,
      xprv: CryptoJS.AES.encrypt(xprv, String(key)).toString(),
    })
  );

  return true;
};

describe('Account Test', () => {
  it('should return a decrypt string', () => {
    const value = 'test';
    const encrypt = CryptoJS.AES.encrypt(value, 'test123');
    const decrypt = decryptAES(encrypt.toString(), 'test123');
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
    expect(accounts[0]?.address.main).toBe(newAddress);
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
    updateNetworkData({ id: 'main', label: newLabel, beUrl: newUrl });
    const { networks } = store.getState().wallet;
    expect(networks.main.label).toBe(newLabel);
  });
  it('should update transaction data', () => {
    const txId =
      '89f20ae3ba21792b60dc32007b273dde4ffa7b9c389bbb688772974fbeb38962';
    updateTransactionData(txId);
  });
  it('should return temporary transaction info', () => {
    const transactionType = 'sendAsset';
    const result = getTemporaryTransaction(transactionType);
    expect(result).toBeNull();
  });
  it('should clear temporary transaction', () => {
    const transactionType = 'sendAsset';
    const result = clearTemporaryTransaction(transactionType);
    expect(result).toBeNull();
  });
  it('should update temporary transaction data', () => {
    const transactionType = 'newNFT';
    const mockJson = {
      fromConnectedAccount: 'test',
      toAddress: 'addressTest',
      amount: 123,
      fee: 123,
      token: 'ADA',
      isToken: false,
      rbf: '',
    };
    updateTemporaryTransaction({
      tx: mockJson,
      type: transactionType,
    });
    expect(temporaryTransaction.newNFT).toStrictEqual(mockJson);
  });
  it('should create new xpub', () => {
    const newXpub = 'test';
    const xprv = 'testXprv';
    setNewXpub(0, newXpub, xprv, '123');
    const { accounts } = store.getState().wallet;
    const account0 = accounts[0].xpub;
    expect(account0).toBe(newXpub);
  });
});
