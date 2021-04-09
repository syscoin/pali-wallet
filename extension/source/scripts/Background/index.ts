/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { browser } from 'webextension-polyfill-ts';
import { wrapStore } from 'webext-redux';
import store from 'state/store';
import { setConnectionInfo, setFirstConnectionStatus, updateConnection, updateCurrentURL } from 'state/wallet';

import MasterController, { IMasterController } from './controllers';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
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
  
        store.dispatch(setConnectionInfo(sender.url));
        store.dispatch(setFirstConnectionStatus(!store.getState().wallet.isConnected));
  
        await browser.windows.create({url: URL, type: 'popup', width: 372, height: 600, left: 900, top: 90});
      }

      if (request.type == 'RESET_CONNECTION_INFO') {
        store.dispatch(setConnectionInfo(''));
        store.dispatch(updateConnection(false));
        store.dispatch(setFirstConnectionStatus(true));
  
        return;
      }

      if (request.type == 'CONFIRM_CONNECTION') {
        store.dispatch(updateConnection(true));
  
        browser.tabs.query({ active: true }).then(async (tabs) => {
          // @ts-ignore
          await browser.tabs.sendMessage(tabs[0].id, { type: 'DISCONNECT' });
        }).then(response => {
          console.log('browser tabs finalized', response)
        });
  
        return;
      }

      if (store.getState().wallet.isConnected) {
        browser.tabs.query({ active: true }).then(async (tabs) => {
          // @ts-ignore
          await browser.tabs.sendMessage(tabs[0].id, { type: 'SEND_DATA', controller: store.getState() });
        }).then(response => {
          console.log('browser tabs finalized', response)
        });
      }
    }
  });

  browser.runtime.onConnect.addListener((port) => {
    browser.tabs.query({ active: true }).then((tabs) => {
      store.dispatch(updateCurrentURL(tabs[0].url));
    });

    port.onDisconnect.addListener(async () => {
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