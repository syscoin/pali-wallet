/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT, /* SYS_NETWORK */ } from 'constants/index';

import { browser } from 'webextension-polyfill-ts';
import { wrapStore } from 'webext-redux';
import store from 'state/store';
// import { dag } from '@stardust-collective/dag4';

import MasterController, { IMasterController } from './controllers';
import { Runtime } from 'webextension-polyfill-ts';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

// NOTE: API Examples
// dag.network.loadBalancerApi.getAddressBalance(ADDRESS)
// dag.network.blockExplorerApi.getTransactionsByAddress(ADDRESS)

browser.runtime.onInstalled.addListener((): void => {
  console.emoji('🤩', 'Syscoin extension installed');
  window.controller.stateUpdater();
});

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
  if (
    port.sender &&
    port.sender.url &&
    port.sender.url?.includes(browser.runtime.getURL('/app.html'))
  ) {
    // const networkId = store.getState().wallet!.activeNetwork ||  SYS_NETWORK.main.id;

    // dag.di.useFetchHttpClient(window.fetch.bind(window));

    // dag.di.useLocalStorageClient(localStorage);

    // dag.network.config({
    //   id: SYS_NETWORK[networkId].id,
    //   beUrl: SYS_NETWORK[networkId].beUrl,
    //   lbUrl: SYS_NETWORK[networkId].lbUrl,
    // });

    // dag.monitor.startMonitor();
    window.controller.wallet.account.watchMemPool();
  }
});

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

wrapStore(store, { portName: STORE_PORT });
