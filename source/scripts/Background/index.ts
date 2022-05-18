import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { wrapStore } from 'webext-redux';
import { browser } from 'webextension-polyfill-ts';
// import { localStorage } from 'redux-persist-webextension-storage';
import { sysweb3Di } from '@pollum-io/sysweb3-core';
import store from 'state/store';

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

browser.runtime.onInstalled.addListener(() => {
  console.emoji('🤩', 'Pali extension enabled');

  sysweb3Di.getStateStorageDb().setPrefix('sysweb3-');
  sysweb3Di.useFetchHttpClient(window.fetch.bind(window));
  sysweb3Di.useLocalStorageClient(window.localStorage);

  window.controller.stateUpdater();
});

wrapStore(store, { portName: STORE_PORT });
