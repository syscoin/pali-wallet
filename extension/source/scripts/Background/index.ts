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
} from 'state/wallet';

import MasterController, { IMasterController } from './controllers';
import { IAccountState } from 'state/wallet/types';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string | undefined;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

browser.runtime.onInstalled.addListener((): void => {
  console.emoji('🤩', 'Syscoin extension installed');

  window.controller.stateUpdater();

  browser.runtime.onMessage.addListener(async (request, sender) => {
    const tabs = await browser.tabs.query({
      active: true,
      windowType: 'normal'
    });

    const createPopup = async (url: string) => {
      return await browser.windows.create({
        url,
        type: 'popup',
        width: 372,
        height: 600,
        left: 900,
        top: 90
      });
    }

    if (typeof request == 'object') {
      if (request.type == 'CONNECT_WALLET' && request.target == 'background') {
        const URL = browser.runtime.getURL('app.html');
        
        store.dispatch(setSenderURL(sender.url));
        store.dispatch(updateCanConnect(true));

        await createPopup(URL);

        window.senderURL = sender.url;

        return;
      }

      if (request.type == 'WALLET_UPDATED' && request.target == 'background') {
        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        return;
      }

      if (request.type == 'RESET_CONNECTION_INFO' && request.target == 'background') {
        store.dispatch(setSenderURL(''));
        store.dispatch(updateCanConnect(false));

        store.dispatch(removeConnection({
          accountId: request.id,
          url: request.url 
        }));

        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        return;
      }

      if (request.type == 'SELECT_ACCOUNT' && request.target == 'background') {
        store.dispatch(updateConnectionsArray({
          accountId: request.id,
          url: window.senderURL 
        }));
       
        return;
      }

      if (request.type == 'CHANGE_CONNECTED_ACCOUNT' && request.target == 'background') {
        store.dispatch(updateConnectionsArray({
          accountId: request.id,
          url: window.senderURL 
        }))

        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });
       
        return;
      }

      if (request.type == 'CONFIRM_CONNECTION' && request.target == 'background') {
        if (window.senderURL == store.getState().wallet.currentURL) {
          store.dispatch(updateCanConnect(false));

          // @ts-ignore
          browser.tabs.sendMessage(tabs[0].id, {
            type: 'WALLET_UPDATED',
            target: 'contentScript',
            connected: false
          });

          return;
        }

        return;
      }

      if (request.type == 'CANCEL_TRANSACTION' && request.target == 'background') {
        store.dispatch(updateCanConfirmTransaction(false));

        return;
      }

      if (request.type == 'CLOSE_POPUP' && request.target == 'background') {
        store.dispatch(updateCanConnect(false));
        store.dispatch(updateCanConfirmTransaction(false));

        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'WALLET_UPDATED',
          target: 'contentScript',
          connected: false
        });

        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'DISCONNECT',
          target: 'contentScript'
        });

        return;
      }

      if (request.type == 'SEND_STATE_TO_PAGE' && request.target == 'background') {
         //@ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'SEND_STATE_TO_PAGE',
          target: 'contentScript',
          state: store.getState().wallet
        });
      }

      if (request.type == 'SEND_CONNECTED_ACCOUNT' && request.target == 'background') {
        const connectedAccount = store.getState().wallet.accounts.find((account: IAccountState) => {
          return account.connectedTo.find((url) => url === store.getState().wallet.currentURL);
        });

        //@ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'SEND_CONNECTED_ACCOUNT',
          target: 'contentScript',
          connectedAccount
        });
      }

      if (request.type == 'TRANSFER_SYS' && request.target == 'background') {
        window.controller.wallet.account.updateTempTx({
          fromAddress: request.fromActiveAccountId,
          toAddress: request.toAddress,
          amount: request.amount,
          fee: request.fee,
          token: null,
          isToken: false,
          rbf: true
        });

        store.dispatch(updateCanConfirmTransaction(true));

        const URL = browser.runtime.getURL('app.html');

        await createPopup(URL);

        //@ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'TRANSFER_SYS',
          target: 'contentScript',
          complete: true 
        });
      }

      if (request.type == 'SEND_NFT' && request.target == 'background') {
       //@ts-ignore
       browser.tabs.sendMessage(tabs[0].id, {
          type: 'SEND_NFT',
          target: 'contentScript',
          responseSendNFT: 'Send NFT ok'
        });
      }

      if (request.type == 'SEND_SPT' && request.target == 'background') {
        // @ts-ignore
        browser.tabs.sendMessage(tabs[0].id, {
          type: 'SEND_SPT',
          target: 'contentScript',
          responseSendSPT: 'Send SPT ok'
        });
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    browser.tabs.query({ active: true })
      .then((tabs) => {
        store.dispatch(updateCurrentURL(tabs[0].url));
      });

    port.onDisconnect.addListener(async () => {
      store.dispatch(updateCanConnect(false));
      store.dispatch(updateCanConfirmTransaction(false));
      
      const all = await browser.windows.getAll();

      if (all.length > 1) {
        const windowId = all[1].id;
        // @ts-ignore
        await browser.windows.remove(windowId);
      }
    })
  });
});

wrapStore(store, { portName: STORE_PORT });