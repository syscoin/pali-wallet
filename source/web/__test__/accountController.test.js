const CryptoJS = require('crypto-js');
const bech32 = require('bech32');
// const sys = require('syscoinjs-lib');
const { initialMockState, SYS_NETWORK } = require('../staticState/store');
const { default: store } = require('../dynamicState/store');
const { default: axios } = require('axios');
import {
  createAccount,
  updateStatus,
  updateAccount,
  updateLabel,
  updateTransactions,
  updateAccountAddress,
  updateAccountXpub,
  updateSwitchNetwork,
  updateAllTokens,
  setTimer,
  updateNetwork,
  setTemporaryTransactionState,
} from '../dynamicState/wallet';

const xpub =
  'zpub6rowqhwXmUCV5Dem7TFFWQSisgK9NwbdkJDYMqBi7JoRHK8fd9Zobr4bdJPGhzGvniAhfrCAbNetRqSDsbTQBXPdN4qzyNv5B1SMsWVtin2';

const decryptAES = (encryptedString, key) => {
  return CryptoJS.AES.decrypt(encryptedString, key).toString(CryptoJS.enc.Utf8);
};
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
const fetchAccountInfo = async (isHardwareWallet, xpub) => {
  let response = null;
  let sysjs;

  if (isHardwareWallet) {
    response = await axios.get(
      `${SYS_NETWORK.testnet.beUrl}/api/v2/xpub/${xpub}?tokens=nonzero&details=txs/`
    );

    const account0 = new fromZPub(
      xpub,
      sysjs?.Signer.Signer.pubtypes,
      sysjs?.Signer.Signer.networks
    );
    let receivingIndex = -1;

    if (response.tokens) {
      response.tokens.forEach((token) => {
        if (token.path) {
          const splitPath = token.path.split('/');

          if (splitPath.length >= 6) {
            const change = parseInt(splitPath[4], 10);
            const index = parseInt(splitPath[5], 10);

            if (change === 1) {
              return;
            }

            if (index > receivingIndex) {
              receivingIndex = index;
            }
          }
        }
      });
    }

    return {
      response,
    };
  }

  response = await axios.get(
    `${SYS_NETWORK.testnet.beUrl}/api/v2/xpub/${xpub}?tokens=nonzero&details=txs/`
  );

  return {
    response,
  };
};
const getAccountInfo = async (isHardwareWallet, xpub) => {
  const { address, response } = await fetchAccountInfo(isHardwareWallet, xpub);

  const assets = [];
  let transactions = [];

  if (response.transactions) {
    transactions = response.transactions
      .map(({ txid, value, confirmations, fees, blockTime, tokenType }) => {
        txid, value, confirmations, fees, blockTime, tokenType;
      })
      .slice(0, 20);
  }

  if (response.tokensAsset) {
    const transform = response.tokensAsset.reduce(
      (item, { type, assetGuid, symbol, balance, decimals }) => {
        item[assetGuid];
        {
          type,
            assetGuid,
            (symbol = symbol ? atob(String(symbol)) : ''),
            (balance =
              (item[assetGuid] ? item[assetGuid].balance : 0) +
              Number(balance)),
            decimals;
        }

        return item;
      },
      {}
    );

    for (const key in transform) {
      assets.push(transform[key]);
    }
  }

  if (address) {
    return {
      balance: response.balance / 1e8,
      assets,
      transactions,
      address,
    };
  }

  return {
    balance: response.balance / 1e8,
    assets,
    transactions,
  };
};

const getLatestUpdate = async () => {
  let globalAccount;
  let sysjs;
  const { activeAccountId, accounts } = store.getState().wallet;

  if (!accounts.find((account) => account.id === activeAccountId)) {
    return;
  }

  globalAccount = accounts.find((account) => account.id === activeAccountId);

  if (!globalAccount?.isTrezorWallet) {
    sysjs?.Signer?.setAccountIndex(activeAccountId);

    const accLatestInfo = await getAccountInfo(false, xpub);

    if (!accLatestInfo) return;

    const { balance, transactions, assets } = accLatestInfo;

    store.dispatch(
      updateAccount({
        id: activeAccountId,
        balance,
        transactions,
        assets,
      })
    );

    store.dispatch(updateSwitchNetwork(false));

    return;
  }

  const trezorAccountLatestInfo = await getAccountInfo(true, xpub);

  if (!trezorAccountLatestInfo) return;

  const trezorData = trezorAccountLatestInfo;

  store.dispatch(
    updateAccount({
      id: activeAccountId,
      balance: trezorData.balance,
      transactions: trezorData.transactions,
      assets: trezorData.assets,
    })
  );

  store.dispatch(updateSwitchNetwork(false));
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

const getConnectedAccount = () => {
  const { accounts, tabs } = store.getState().wallet;
  const { currentURL } = tabs;
  return accounts.find((account) => {
    return account.connectedTo.find((url) => {
      return url === new URL(currentURL).host;
    });
  });
};

const coventPendingType = (txid) => ({
  txid,
  value: 0,
  confirmations: 0,
  fees: 0,
  blockTime: Date.now() / 1e3,
});

const updateTransactionData = (txinfo) => {
  let globalAccount;
  const transactionItem =
    store.getState().wallet.temporaryTransactionState.type === 'sendAsset';

  let transactions = [];

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
      txs: [coventPendingType(txinfo), ...transactions],
    })
  );
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
});
