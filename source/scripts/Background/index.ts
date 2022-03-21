/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { wrapStore } from 'webext-redux';
import { browser, Runtime } from 'webextension-polyfill-ts';
import store from 'state/store';

import MasterController, { IMasterController } from './controllers';
import { messagesHandler } from './controllers/MessageHandler';
declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    senderURL: string;
    syspopup: any;
  }
}

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
  if (port.name === 'pali') {
    console.log('on connect port pali');

    messagesHandler(port, window.controller);

    return;
  }

  // if (
  //   port.sender &&
  //   port.sender.url &&
  //   (port.sender.url?.includes(browser.runtime.getURL('/app.html')) ||
  //     port.sender.url?.includes(browser.runtime.getURL('/external.html')))
  // ) {
  //   const vault = store.getState().vault;
  //   const networkId =
  //     vault &&
  //     vault.activeNetwork &&
  //     vault.activeNetwork[KeyringNetwork.Constellation];
  //   const networkInfo =
  //     (networkId && DAG_NETWORK[networkId]) || DAG_NETWORK.main;
  //   dag4.di.getStateStorageDb().setPrefix('stargazer-');
  //   dag4.di.useFetchHttpClient(window.fetch.bind(window));
  //   dag4.di.useLocalStorageClient(localStorage);
  //   dag4.network.config({
  //     id: networkInfo.id,
  //     beUrl: networkInfo.beUrl,
  //     lbUrl: networkInfo.lbUrl,
  //   });

  //   port.onDisconnect.addListener(() => {
  //     console.log('onDisconnect');
  //     window.controller.wallet.account.assetsBalanceMonitor.stop();
  //   });

  //   console.log('onConnect');
  //   if (window.controller.wallet.isUnlocked()) {
  //     window.controller.wallet.account.assetsBalanceMonitor.start();
  //     window.controller.wallet.account.getLatestTxUpdate();
  //   }
  // }
});

browser.runtime.onInstalled.addListener(() => {
  if (!window.controller) {
    window.controller = Object.freeze(MasterController());
    setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
  }

  console.emoji('🤩', 'Pali extension enabled');

  window.controller.stateUpdater();
});

wrapStore(store, { portName: STORE_PORT });
