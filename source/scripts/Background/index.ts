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
    gatewayNetwork: string;
    senderURL: string;
    syspopup: any;
  }
}

browser.runtime.onConnect.addListener((port: Runtime.Port) => {
  console.log('connected pali');

  if (port.name === 'pali') {
    console.log('on connect port pali');

    messagesHandler(port, window.controller);

    return;
  }

  if (
    port.sender &&
    port.sender.url &&
    (port.sender.url?.includes(browser.runtime.getURL('/app.html')) ||
      port.sender.url?.includes(browser.runtime.getURL('/external.html')))
  ) {
    console.log('port is external', port);

    port.onDisconnect.addListener(() => {
      console.log('onDisconnect');
    });
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
