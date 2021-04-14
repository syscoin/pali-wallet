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
} from 'state/wallet';

import MasterController, { IMasterController } from './controllers';

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
    if (typeof request == 'object') {
      if (request.type == 'OPEN_WALLET_POPUP') {
        const URL = browser.runtime.getURL('app.html');
        
        store.dispatch(setSenderURL(sender.url));
        store.dispatch(updateCanConnect(true));

        await browser.windows.create({ url: URL, type: 'popup', width: 372, height: 600, left: 900, top: 90 });

        window.senderURL = sender.url;

        return;
      }

      if (request.type == 'RESET_CONNECTION_INFO') {
        store.dispatch(setSenderURL(''));
        store.dispatch(updateCanConnect(false));
        store.dispatch(removeConnection({ accountId: request.id, url: request.url }));

        return;
      }

      if (request.type == 'SELECT_ACCOUNT') {
        store.dispatch(updateConnectionsArray({ accountId: request.id, url: window.senderURL }));
       
        return;
      }

      if (request.type == 'CHANGE_CONNECTED_ACCOUNT') {
        store.dispatch(updateConnectionsArray({ accountId: request.id, url: window.senderURL }));
       
        return;
      }

      if (request.type == 'CONFIRM_CONNECTION') {
        if (window.senderURL == store.getState().wallet.currentURL) {
          store.dispatch(updateCanConnect(false));

          return;
        }

        return;
      }

      if (request.type == 'CLOSE_POPUP') {
        store.dispatch(updateCanConnect(false));
        browser.tabs.query({ active: true }).then(async (tabs) => {
          // @ts-ignore
          await browser.tabs.sendMessage(tabs[0].id, { type: 'DISCONNECT' });
        }).then(() => {
          console.log('Disconnected.');
        });

        return;
      }

      // if (store.getState().wallet.isConnected) {
      //   browser.tabs.query({ active: true }).then(async (tabs) => {
      //     // @ts-ignore
      //     await browser.tabs.sendMessage(tabs[0].id, { type: 'SEND_DATA', controller: store.getState() });
      //   }).then(response => {
      //     console.log('browser tabs finalized', response)
      //   });
      // }
    }
  });

  browser.runtime.onConnect.addListener(async (port) => {
    browser.tabs.query({ active: true }).then((tabs) => {
      store.dispatch(updateCurrentURL(tabs[0].url));
    });

    port.onDisconnect.addListener(async () => {
      store.dispatch(updateCanConnect(false));
      
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