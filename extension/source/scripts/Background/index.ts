/* eslint-disable prettier/prettier */
import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { browser } from 'webextension-polyfill-ts';
import { wrapStore } from 'webext-redux';
import store from 'state/store';

import MasterController, { IMasterController } from './controllers';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

browser.runtime.onInstalled.addListener((): void => {
  console.emoji('🤩', 'Syscoin extension installed');
  window.controller.stateUpdater();
});

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
}

wrapStore(store, { portName: STORE_PORT });
