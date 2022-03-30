import 'emoji-log';
import { STORE_PORT } from 'constants/index';

import { wrapStore } from 'webext-redux';
import { browser } from 'webextension-polyfill-ts';
import store from 'state/store';

import MasterController, { IMasterController } from './controllers';

declare global {
  interface Window {
    controller: Readonly<IMasterController>;
    gatewayNetwork: string;
    senderURL: string;
    syspopup: any;
  }
}

browser.runtime.onInstalled.addListener(() => {
  if (!window.controller) {
    window.controller = Object.freeze(MasterController());

    setInterval(window.controller.stateUpdater, 3 * 60 * 1000);
  }

  console.emoji('🤩', 'Pali extension enabled');

  window.controller.stateUpdater();
});

wrapStore(store, { portName: STORE_PORT });
