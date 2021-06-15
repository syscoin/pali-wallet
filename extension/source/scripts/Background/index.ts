/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { browser } from 'webextension-polyfill-ts';
import { wrapStore } from 'webext-redux';
import store from 'state/store';
import {
  setSenderURL,
  updateCanConnect,
  updateCurrentURL,
  updateConnectionsArray,
  removeConnection,
  updateCanConfirmTransaction,
  createAsset,
  issueAsset,
  issueNFT,
  setUpdateAsset,
  setTransferOwnership,
} from 'state/wallet';

import MasterController, { IMasterController } from './controllers';
import { IAccountState } from 'state/wallet/types';
import { getHost } from './helpers';
// var TrezorConnect = require('trezor-connect').default;
import TrezorConnect from 'trezor-connect';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string;
    trezorConnect: any;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

const observeStore = async (store: any) => {
  let currentState: any;

  const handleChange = async () => {
    let nextState = store.getState();

    if (nextState !== currentState) {
      currentState = nextState;

      const tabs = await browser.tabs.query({
        active: true,
        windowType: 'normal'
      });

      const isAccountConnected = store.getState().wallet.accounts.findIndex((account: IAccountState) => {
        return account.connectedTo.find((url: string) => {
          return url === new URL(`${tabs[0].url}`).host;
        })
      }) >= 0;

      if (isAccountConnected) {
        await browser.tabs.sendMessage(Number(tabs[0].id), {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        return;
      }
    }
  }

  let unsubscribe = store.subscribe(handleChange);

  await handleChange();

  return unsubscribe;
}

observeStore(store);

browser.runtime.onInstalled.addListener(async () => {
  console.emoji('🤩', 'Syscoin extension installed');

  window.controller.stateUpdater();

  TrezorConnect.init({
    connectSrc: 'https://localhost:8088/',
    lazyLoad: true, // this param will prevent iframe injection until TrezorConnect.method will be called
    manifest: {
      email: 'claudiocarvalhovilasboas@gmail.com',
      appUrl: 'https://syscoin.org/',
    }
  });
  window.trezorConnect = TrezorConnect;
  browser.runtime.onMessage.addListener(async (request, sender) => {
    const {
      type,
      target
    } = request;

    const tabs = await browser.tabs.query({
      active: true,
      windowType: 'normal'
    });

    const tabId = Number(tabs[0].id);

    const createPopup = async (url: string) => {
      const allWindows = await browser.windows.getAll({
        windowTypes: ['popup']
      });

      if (allWindows[0]) {
        await browser.windows.update(Number(allWindows[0].id), {
          drawAttention: true,
          focused: true
        });

        return;
      }

      await browser.windows.create({
        url,
        type: 'popup',
        width: 372,
        height: 600,
        left: 900,
        top: 90
      });
    };

    if (typeof request == 'object') {
      if (type == 'CONNECT_WALLET' && target == 'background') {
        const url = browser.runtime.getURL('app.html');

        store.dispatch(setSenderURL(`${sender.url}`));
        store.dispatch(updateCanConnect(true));

        await createPopup(url);

        window.senderURL = `${sender.url}`;

        return;
      }

      if (type == 'RESET_CONNECTION_INFO' && target == 'background') {
        store.dispatch(updateCanConnect(false));
        store.dispatch(removeConnection({
          accountId: request.id,
          url: request.url
        }));
        store.dispatch(setSenderURL(''));

        Promise.resolve(browser.tabs.sendMessage(Number(tabs[0].id), {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        }).then((response) => {
          console.log('wallet updated', response)
        }))

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
        if (getHost(window.senderURL) == getHost(store.getState().wallet.currentURL)) {
          store.dispatch(updateCanConnect(false));

          browser.tabs.sendMessage(tabId, {
            type: 'WALLET_CONNECTION_CONFIRMED',
            target: 'contentScript',
            connectionConfirmed: true,
            state: store.getState().wallet
          });

          return;
        }

        return;
      }

      if (type == 'CANCEL_TRANSACTION' && target == 'background') {
        store.dispatch(updateCanConfirmTransaction(false));
        store.dispatch(createAsset(false));
        store.dispatch(issueAsset(false));
        store.dispatch(issueNFT(false));
        store.dispatch(setUpdateAsset(false));
        store.dispatch(setTransferOwnership(false));

        return;
      }

      if (type == 'CLOSE_POPUP' && target == 'background') {
        store.dispatch(updateCanConnect(false));
        store.dispatch(updateCanConfirmTransaction(false));
        store.dispatch(createAsset(false));
        store.dispatch(issueAsset(false));
        store.dispatch(issueNFT(false));
        store.dispatch(setUpdateAsset(false));
        store.dispatch(setTransferOwnership(false));

        browser.tabs.sendMessage(tabId, {
          type: 'DISCONNECT',
          target: 'contentScript'
        });

        return;
      }

      if (type == 'SEND_STATE_TO_PAGE' && target == 'background') {
        browser.tabs.sendMessage(tabId, {
          type: 'SEND_STATE_TO_PAGE',
          target: 'contentScript',
          state: store.getState().wallet
        });
      }

      if (type == 'SEND_CONNECTED_ACCOUNT' && target == 'background') {
        const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
          return account.connectedTo.find((url) => {
            return url === getHost(store.getState().wallet.currentURL)
          });
        });

        browser.tabs.sendMessage(tabId, {
          type: 'SEND_CONNECTED_ACCOUNT',
          target: 'contentScript',
          connectedAccount
        });
      }

      if (type == 'CHECK_ADDRESS' && target == 'background') {
        const isValidSYSAddress = window.controller.wallet.account.isValidSYSAddress(request.address, store.getState().wallet.activeNetwork);

        browser.tabs.sendMessage(tabId, {
          type: 'CHECK_ADDRESS',
          target: 'contentScript',
          isValidSYSAddress
        });
      }

      if (type == 'SEND_TOKEN' && target == 'background') {
        const {
          fromConnectedAccount,
          toAddress,
          amount,
          fee,
          token,
          isToken,
          rbf
        } = request;

        window.controller.wallet.account.updateTempTx({
          fromAddress: fromConnectedAccount,
          toAddress,
          amount,
          fee,
          token,
          isToken,
          rbf
        });

        store.dispatch(updateCanConfirmTransaction(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'SEND_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_PAGE_TO_CREATE_TOKEN' && target == 'background') {
        const {
          precision,
          symbol,
          maxsupply,
          description,
          receiver,
        } = request;

        window.controller.wallet.account.setDataFromPageToCreateNewSPT({
          precision,
          symbol,
          maxsupply,
          description,
          receiver
        });

        store.dispatch(createAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'DATA_FROM_PAGE_TO_CREATE_TOKEN',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_CREATE_TOKEN' && target == 'background') {
        window.controller.wallet.account.createSPT({
          ...window.controller.wallet.account.getDataFromPageToCreateNewSPT(),
          ...window.controller.wallet.account.getDataFromWalletToCreateSPT()
        });
      }

      if (type == 'ISSUE_SPT' && target == 'background') {
        const {
          amount,
          receiver,
          assetGuid
        } = request;

        window.controller.wallet.account.setDataFromPageToMintSPT({
          assetGuid,
          receiver,
          amount: Number(amount)
        });

        store.dispatch(issueAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'ISSUE_SPT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_MINT_TOKEN' && target == 'background') {
        window.controller.wallet.account.issueSPT({
          ...window.controller.wallet.account.getDataFromPageToMintSPT(),
          ...window.controller.wallet.account.getDataFromWalletToMintSPT()
        });
      }

      if (type == 'ISSUE_NFT' && target == 'background') {
        const {
          assetGuid,
          nfthash,
          receiver,
        } = request;

        window.controller.wallet.account.setDataFromPageToMintNFT({
          assetGuid,
          receiver,
          nfthash
        });

        store.dispatch(issueNFT(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'ISSUE_NFT',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_MINT_NFT' && target == 'background') {
        window.controller.wallet.account.issueNFT({
          ...window.controller.wallet.account.getDataFromPageToMintNFT(),
          ...window.controller.wallet.account.getDataFromWalletToMintNFT()
        });
      }

      if (type == 'UPDATE_ASSET' && target == 'background') {
        const {
          assetGuid,
          contract,
          capabilityflags,
          description,
          notarydetails,
          auxfeedetails,
          notarykeyid
        } = request;

        window.controller.wallet.account.setDataFromPageToUpdateAsset({
          assetGuid,
          contract,
          capabilityflags,
          description,
          notarydetails,
          auxfeedetails,
          notarykeyid
        });

        store.dispatch(setUpdateAsset(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'UPDATE_ASSET',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_UPDATE_TOKEN' && target == 'background') {
        window.controller.wallet.account.setUpdateAsset({
          ...window.controller.wallet.account.getDataFromPageToUpdateAsset(),
          ...window.controller.wallet.account.getDataFromWalletToUpdateAsset()
        });
      }

      if (type == 'TRANSFER_OWNERSHIP' && target == 'background') {
        const {
          assetGuid,
          newOwner
        } = request;

        window.controller.wallet.account.setDataFromPageToTransferOwnership({
          assetGuid,
          newOwner
        });

        store.dispatch(setTransferOwnership(true));

        const appURL = browser.runtime.getURL('app.html');

        await createPopup(appURL);

        browser.tabs.sendMessage(tabId, {
          type: 'UPDATE_ASSET',
          target: 'contentScript',
          complete: true
        });
      }

      if (type == 'DATA_FROM_WALLET_TO_TRANSFER_OWNERSHIP' && target == 'background') {
        window.controller.wallet.account.setNewOwnership({
          ...window.controller.wallet.account.getDataFromPageToTransferOwnership(),
          ...window.controller.wallet.account.getDataFromWalletToTransferOwnership()
        });
      }

      if (type == 'CREATE_COLLECTION' && target == 'background') {
        const {
          collectionName,
          description,
          sysAddress,
          symbol,
          property1,
          property2,
          property3,
          attribute1,
          attribute2,
          attribute3
        } = request;

        window.controller.wallet.account.createCollection(collectionName, description, sysAddress, symbol, property1, property2, property3, attribute1, attribute2, attribute3)

        const createCollection: string = 'create collection is working';

        browser.tabs.sendMessage(tabId, {
          type: 'CREATE_COLLECTION',
          target: 'contentScript',
          createCollection
        });
      }

      if (type == 'GET_USER_MINTED_TOKENS' && target == 'background') {
        const tokensMinted = await window.controller.wallet.account.getUserMintedTokens();

        browser.tabs.sendMessage(tabId, {
          type: 'GET_USER_MINTED_TOKENS',
          target: 'contentScript',
          userTokens: tokensMinted
        });
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name == 'trezor-connect') {
      return;
    }

    browser.tabs.query({ active: true })
      .then((tabs) => {
        store.dispatch(updateCurrentURL(`${tabs[0].url}`));
      });

    port.onDisconnect.addListener(async () => {
      store.dispatch(updateCanConnect(false));
      store.dispatch(updateCanConfirmTransaction(false));
      store.dispatch(createAsset(false));
      store.dispatch(setUpdateAsset(false));
      store.dispatch(issueNFT(false));
      store.dispatch(issueAsset(false));
      store.dispatch(setTransferOwnership(false));

      const all = await browser.windows.getAll();

      if (all.length > 1) {
        const windowId = Number(all[1].id);

        await browser.windows.remove(windowId);
      }
    })
  });
});

wrapStore(store, { portName: STORE_PORT });

// used only for development mode to automatically reload the extension when starting the browser
// remove this in production

chrome.runtime.onStartup.addListener(() => {
  chrome.runtime.reload();
})
