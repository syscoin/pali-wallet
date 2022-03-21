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
