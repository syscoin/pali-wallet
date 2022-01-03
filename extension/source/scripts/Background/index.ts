/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { wrapStore } from 'webext-redux';
import Bowser from "bowser";
import { browser } from 'webextension-polyfill-ts';
import store from 'state/store';
import {
  setSenderURL,
  updateCanConnect,
  updateCurrentURL,
  updateConnectionsArray,
  removeConnection,
  updateCanConfirmTransaction,
  clearAllTransactions,
  setTemporaryTransactionState,
} from 'state/wallet';
import { IAccountState } from 'state/wallet/types';

import MasterController, { IMasterController } from './controllers';
import { getHost } from './helpers';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string;
    syspopup: any;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

let timeout: any;

const restartLockTimeout = () => {
  const {
    temporaryTransactionState,
    timer
  } = store.getState().wallet;

  if (timeout) {
    clearTimeout(timeout);
  }

  timeout = setTimeout(() => {
    if (
      !checkIsLocked()
      && temporaryTransactionState.executing
    ) {
      window.controller.wallet.logOut();

      setTimeout(() => closePopup(), 2000);

      return;
    }

    console.log('can\'t lock automatically - wallet is under transaction');
  }, timer * 60 * 1000);
};

const getTabs = async (options: any) => {
  return await browser.tabs.query(options);
};

const getConnectedAccountIndex = ({ match }: any) => {
  return store.getState().wallet.accounts.findIndex((account: IAccountState) => {
    return account.connectedTo.find((url: string) => {
      return url === match;
    })
  });
};

const checkIsLocked = () => {
  return window.controller.wallet.isLocked();
};

const checkToCallPrivateMethods = () => {
  if (checkIsLocked() || getConnectedAccountIndex({ match: new URL(store.getState().wallet.tabs.currentURL).host }) === -1) {
    return {
      error: true,
      message: 'Please, check if your wallet is unlocked and connected and try again.'
    }
  }

  return {
    error: false,
    message: null
  }
};

const runtimeSendMessageToTabs = async ({ tabId, messageDetails }: any) => {
  return await browser.tabs.sendMessage(Number(tabId), messageDetails);
}

const updateActiveWindow = async ({ windowId, options }: any) => {
  return await browser.windows.update(Number(windowId), options);
}

const observeStore = async (store: any) => {
  let currentState: any;

  const handleChange = async () => {
    const nextState = store.getState();

    if (nextState !== currentState) {
      currentState = nextState;

      const tabs: any = await getTabs({ active: true, windowType: 'normal' });

      for (const tab of tabs) {
        if (tab) {
          if (getConnectedAccountIndex({ match: new URL(String(tab.url)).host }) >= 0) {
            try {
              await runtimeSendMessageToTabs({
                tabId: Number(tab.id),
                messageDetails: {
                  type: 'WALLET_UPDATED',
                  target: 'contentScript',
                  connected: false
                }
              });
            } catch (error) {
              console.log('error', error);
            }
          }
        }
      }
    }
  }

  const unsubscribe = store.subscribe(handleChange);

  await handleChange();

  return unsubscribe;
};

observeStore(store);

const closePopup = () => {
  store.dispatch(updateCanConnect(false));
  store.dispatch(clearAllTransactions());

  browser.tabs.query({ active: true })
    .then(async (tabs) => {
      tabs.map(async (tab) => {
        if (tab.title === 'Pali Wallet') {
          await browser.windows.remove(Number(tab.windowId));
        }
      });
    })
    .catch((error) => {
      console.log('error removing window', error);
    });

  return;
}

const createPopup = async (url: string) => {
  const [tab]: any = await getTabs({ active: true, lastFocusedWindow: true });

  if (tab.title === 'Pali Wallet') {
    return;
  }

  store.dispatch(updateCurrentURL(String(tab.url)));

  const [sysWalletPopup]: any = await getTabs({ url: browser.runtime.getURL('app.html') });

  console.log('sysWalletpopup exists', sysWalletPopup)

  if (sysWalletPopup) {
    console.log('sys wallet popup active update window', sysWalletPopup)

    await updateActiveWindow({
      windowId: Number(sysWalletPopup.windowId),
      options: {
        drawAttention: true,
        focused: true
      }
    });

    return;
  }

  const sysPopup = await browser.windows.create({
    url,
    type: "popup",
    height: 600,
    width: 372,
    left: 900,
    top: 90,
  });

  window.syspopup = sysPopup.id;
};

browser.windows.onRemoved.addListener((windowId: any) => {
  if (windowId > -1 && windowId === window.syspopup) {
    console.log('clearing all transactions')

    store.dispatch(clearAllTransactions());
  }
})

browser.runtime.onMessage.addListener(async (request, sender) => {
  const {
    type,
    target
  } = request;

  let tabId: any;

  const tabs = await getTabs({});

  const [tab]: any = await getTabs({ active: true, windowType: 'normal' });

  if (tab) {
    if (getConnectedAccountIndex({ match: new URL(String(tab.url)).host }) >= 0) {
      tabId = tab.id;
    }
  }

  if (typeof request === 'object') {
    if (type == 'SET_MOUSE_MOVE' && target == 'background') {
      restartLockTimeout();
    }

    if (type == 'WALLET_ERROR' && target == 'background') {
      const {
        transactionError,
        invalidParams,
        message
      } = request;

      runtimeSendMessageToTabs({ tabId, messageDetails: { type: 'WALLET_ERROR', target: 'contentScript', transactionError, invalidParams, message } });
    }

    if (type == 'TRANSACTION_RESPONSE' && target == 'background') {
      runtimeSendMessageToTabs({ tabId, messageDetails: { type: 'TRANSACTION_RESPONSE', target: 'contentScript', response: request.response } });

      const interval = setInterval(async () => {
        if (request.response.txid) {
          const data = await window.controller.wallet.account.getTransactionInfoByTxId(request.response.txid);

          console.log('updating tokens state using txid: ', request.response.txid)

          if (data.confirmations > 0) {
            window.controller.wallet.account.updateTokensState().then(() => {
              window.controller.wallet.account.setHDSigner(store.getState().wallet.activeAccountId);
            });

            clearInterval(interval);
          }
        }
      }, 6000);
    }

    if (type == 'RESET_CONNECTION_INFO' && target == 'background') {
      const { id, url } = request;

      store.dispatch(updateCanConnect(false));
      store.dispatch(removeConnection({ accountId: id, url }));
      store.dispatch(setSenderURL(''));

      browser.tabs.query({ url })
        .then((tabs) => {
          if (tabs) {
            tabs.map((tab: any) => {
              Promise.resolve(browser.tabs.sendMessage(Number(tab.id), {
                type: 'WALLET_UPDATED',
                target: 'contentScript',
                connected: false
              }).then(() => {
                console.log('wallet updated')
              }).catch(() => {
                console.log('extension context invalidated in other tabs with the same url, you need to refresh the tab')
              }))
            })
          }
        }).catch((error) => {
          console.log('error getting tabs', error);
        });

      return;
    }

    if (type == 'SELECT_ACCOUNT' && target == 'background') {
      store.dispatch(updateConnectionsArray({
        accountId: request.id,
        url: window.senderURL
      }));

      return;
    }

    if (type == 'CHANGE_CONNECTED_ACCOUNT' && target == 'background') {
      store.dispatch(updateConnectionsArray({
        accountId: request.id,
        url: window.senderURL
      }));

      return;
    }

    if (type == 'CONFIRM_CONNECTION' && target == 'background') {
      if (getHost(window.senderURL)) {
        store.dispatch(updateCanConnect(false));

        for (let tab of tabs) {
          browser.tabs.sendMessage(Number(tab.id), {
            type: 'WALLET_CONNECTION_CONFIRMED',
            target: 'contentScript',
            connectionConfirmed: true,
            state: store.getState().wallet
          }).then(() => {
            console.log('wallet connection confirmed')
          }).catch((error) => {
            console.log('error confirming connection', error);
          });
        }
      }

      return;
    }

    if (type == 'CANCEL_TRANSACTION' && target == 'background') {
      const { item } = request;

      store.dispatch(clearAllTransactions());

      window.controller.wallet.account.clearTemporaryTransaction(item);

      return;
    }

    if (type == 'CLOSE_POPUP' && target == 'background') {
      closePopup();
    }

    if (type == 'SEND_STATE_TO_PAGE' && target == 'background') {
      checkToCallPrivateMethods();

      const {
        status,
        accounts,
        activeAccountId,
        activeNetwork,
        confirmingTransaction,
        mintNFT,
        changingNetwork,
        signingTransaction,
        signingPSBT,
        walletTokens,
      } = store.getState().wallet;

      const copyAccounts: any = {};

      for (const { address, id, balance, assets, isTrezorWallet, label, transactions, xpub } of accounts) {
        copyAccounts[id] = {
          address,
          balance,
          assets,
          id,
          isTrezorWallet: isTrezorWallet,
          label: label,
          transactions: transactions,
          xpub: xpub
        }
      }

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'SEND_STATE_TO_PAGE',
        target: 'contentScript',
        state: getConnectedAccountIndex({ match: new URL(store.getState().wallet.tabs.currentURL).host }) > -1 && !window.controller.wallet.isLocked() ? {
          status,
          accounts: Object.values(copyAccounts),
          activeAccountId,
          activeNetwork,
          confirmingTransaction,
          mintNFT,
          changingNetwork,
          signingTransaction,
          signingPSBT,
          walletTokens,
        } : null
      });
    }

    if (type == 'CHECK_IS_LOCKED' && target == 'background') {
      const isLocked = window.controller.wallet.isLocked();

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'CHECK_IS_LOCKED',
        target: 'contentScript',
        isLocked
      });
    }

    if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'background') {
      const connectedAccount: any = store.getState().wallet.accounts.find((account: IAccountState) => {
        return account.connectedTo.find((url) => {
          return url === getHost(store.getState().wallet.tabs.currentURL)
        });
      });

      let copyConnectedAccount: any = null;

      if (connectedAccount) {
        copyConnectedAccount = {
          address: connectedAccount.address,
          balance: connectedAccount.balance,
          assets: connectedAccount.assets,
          id: connectedAccount.id,
          isTrezorWallet: connectedAccount.isTrezorWallet,
          label: connectedAccount.label,
          transactions: connectedAccount.transactions,
          xpub: connectedAccount.xpub
        }
      }

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'SEND_CONNECTED_ACCOUNT',
        target: 'contentScript',
        copyConnectedAccount
      });
    }

    if (type == 'CONNECTED_ACCOUNT_XPUB' && target == 'background') {
      checkToCallPrivateMethods();

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'CONNECTED_ACCOUNT_XPUB',
        target: 'contentScript',
        connectedAccountXpub: window.controller.wallet.account.getConnectedAccountXpub()
      });
    }

    if (type == 'CONNECTED_ACCOUNT_CHANGE_ADDRESS' && target == 'background') {
      checkToCallPrivateMethods();

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'CONNECTED_ACCOUNT_CHANGE_ADDRESS',
        target: 'contentScript',
        connectedAccountChangeAddress: await window.controller.wallet.account.getChangeAddress()
      });
    }

    if (type == 'CHECK_ADDRESS' && target == 'background') {
      checkToCallPrivateMethods();

      const isValidSYSAddress = window.controller.wallet.account.isValidSYSAddress(request.messageData, store.getState().wallet.activeNetwork, true);

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'CHECK_ADDRESS',
        target: 'contentScript',
        isValidSYSAddress
      });
    }

    if (type == 'GET_HOLDINGS_DATA' && target == 'background') {
      checkToCallPrivateMethods();

      const holdingsData = await window.controller.wallet.account.getHoldingsData();

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'GET_HOLDINGS_DATA',
        target: 'contentScript',
        holdingsData
      });

    }

    if (type == 'GET_USER_MINTED_TOKENS' && target == 'background') {
      checkToCallPrivateMethods();

      const tokensMinted = await window.controller.wallet.account.getUserMintedTokens();

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'GET_USER_MINTED_TOKENS',
        target: 'contentScript',
        userTokens: tokensMinted
      });
    }

    if (type == 'GET_ASSET_DATA' && target == 'background') {
      checkToCallPrivateMethods();

      const assetData = await window.controller.wallet.account.getDataAsset(request.messageData);

      browser.tabs.sendMessage(Number(sender.tab?.id), {
        type: 'GET_ASSET_DATA',
        target: 'contentScript',
        assetData
      });
    }
  }

  if (type == 'CONNECT_WALLET' && target == 'background') {
    const url = browser.runtime.getURL('app.html');

    store.dispatch(setSenderURL(String(sender.url)));
    store.dispatch(updateCanConnect(true));

    await createPopup(url);

    window.senderURL = String(sender.url);

    return;
  }

  if (type == 'SIGN_AND_SEND' && target == 'background') {
    checkToCallPrivateMethods();

    const { messageData } = request;

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: messageData,
      type: 'signAndSendPSBT'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'signAndSendPSBT'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'SIGN_AND_SEND',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'SIGN_PSBT' && target == 'background') {
    checkToCallPrivateMethods();

    const { messageData } = request;

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: messageData,
      type: 'signPSBT'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'signPSBT'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'SIGN_PSBT',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'SEND_TOKEN' && target == 'background') {
    checkToCallPrivateMethods();

    const {
      fromConnectedAccount,
      toAddress,
      amount,
      fee,
      token,
      isToken,
      rbf
    } = request.messageData;

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        fromAddress: fromConnectedAccount,
        toAddress,
        amount,
        fee,
        token,
        isToken,
        rbf
      },
      type: 'sendAsset'
    });

    store.dispatch(updateCanConfirmTransaction(true));

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'SEND_TOKEN',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'DATA_FROM_PAGE_TO_CREATE_TOKEN' && target == 'background') {
    const {
      precision,
      maxsupply,
      receiver,
      initialSupply,
    } = request.messageData;

    if (precision < 0 || precision > 8) {
      throw new Error('invalid precision value');
    }

    if (maxsupply < 0) {
      throw new Error('invalid max supply value');
    }

    if (initialSupply < 0) {
      throw new Error('invalid initial supply value');
    }

    if (!window.controller.wallet.account.isValidSYSAddress(receiver, store.getState().wallet.activeNetwork, true)) {
      throw new Error('invalid receiver address');
    }

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee
      },
      type: 'newAsset'
    });

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'newAsset'
    }));

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);
  }

  if (type == 'ISSUE_SPT' && target == 'background') {
    checkToCallPrivateMethods();

    const {
      amount,
      assetGuid
    } = request.messageData;

    const assetFromAssetGuid = window.controller.wallet.account.getDataAsset(assetGuid);

    if (amount < 0 || amount >= assetFromAssetGuid.balance) {
      throw new Error('invalid amount value');
    }

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee
      },
      type: 'mintAsset'
    });

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'mintAsset'
    }));

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'ISSUE_SPT',
      target: 'contentScript',
      complete: true
    });
  }


  if (type == 'CREATE_AND_ISSUE_NFT' && target == 'background') {
    checkToCallPrivateMethods();

    const {
      issuer,
      precision,
    } = request.messageData;

    if (precision < 0 || precision > 8) {
      throw new Error('invalid total shares value');
    }

    if (!window.controller.wallet.account.isValidSYSAddress(issuer, store.getState().wallet.activeNetwork, true)) {
      throw new Error('invalid receiver address');
    }

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee,
      },
      type: 'newNFT'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'newNFT'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'CREATE_AND_ISSUE_NFT',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'UPDATE_ASSET' && target == 'background') {
    checkToCallPrivateMethods();

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee,
      },
      type: 'updateAsset'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'updateAsset'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'UPDATE_ASSET',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'TRANSFER_OWNERSHIP' && target == 'background') {
    checkToCallPrivateMethods();

    const {
      newOwner
    } = request.messageData;

    if (!window.controller.wallet.account.isValidSYSAddress(newOwner, store.getState().wallet.activeNetwork, true)) {
      throw new Error('invalid new owner address');
    }

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee,
      },
      type: 'transferAsset'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'transferAsset'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'TRANSFER_OWNERSHIP',
      target: 'contentScript',
      complete: true
    });
  }

  if (type == 'ISSUE_NFT' && target == 'background') {
    checkToCallPrivateMethods();

    const fee = await window.controller.wallet.account.getRecommendFee();

    window.controller.wallet.account.updateTemporaryTransaction({
      tx: {
        ...request.messageData,
        fee,
      },
      type: 'mintNFT'
    })

    store.dispatch(setTemporaryTransactionState({
      executing: true,
      type: 'mintNFT'
    }))

    const appURL = browser.runtime.getURL('app.html');

    await createPopup(appURL);

    browser.tabs.sendMessage(Number(sender.tab?.id), {
      type: 'ISSUE_NFT',
      target: 'contentScript',
      complete: true
    });
  }
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name == 'trezor-connect') {
    return;
  }

  browser.tabs.query({ active: true, lastFocusedWindow: true })
    .then((tabs) => {
      if (tabs[0].title === 'Pali Wallet') {
        return;
      }

      store.dispatch(updateCurrentURL(String(tabs[0].url)));
    });
});

const bowser = Bowser.getParser(window.navigator.userAgent);

browser.tabs.onUpdated.addListener((tabId, _, tab) => {
  if (bowser.getBrowserName() === 'Firefox') {
    console.log('browser is firefox, do nothing', tab, tab.title, tabId);

    // fix issue between sysmint & bridge

    return;
  }

  if (
    tab.url !== browser.runtime.getURL('app.html') &&
    tab.url !== store.getState().wallet.tabs.currentURL &&
    tab.title !== 'Pali Wallet'
  ) {
    store.dispatch(updateCurrentURL(String(tab.url)));

    return;
  }
});

browser.runtime.onInstalled.addListener(() => {
  if (!window.controller) {
    window.controller = Object.freeze(MasterController());
    setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
  }

  console.emoji('🤩', 'Pali extension ebabled');

  window.controller.stateUpdater();
});

wrapStore(store, { portName: STORE_PORT });