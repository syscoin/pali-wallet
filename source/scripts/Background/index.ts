import 'emoji-log';
import { wrapStore } from 'webext-redux';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { sysweb3Di } from '@pollum-io/sysweb3-core';

import { STORE_PORT } from 'constants/index';
import store from 'state/store';
// import { localStorage } from 'redux-persist-webextension-storage';
import { log } from 'utils/logger';

import MasterController, { IMasterController } from './controllers';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

if (!window.controller) {
  window.controller = Object.freeze(MasterController());
  setInterval(window.controller.utils.setFiat, 3 * 60 * 1000);
}

browser.runtime.onInstalled.addListener(() => {
  console.emoji('🤩', 'Pali extension enabled');
});

let timeout: any;

const restartLockTimeout = () => {
  const { timer } = store.getState().vault;

  if (timeout) {
    clearTimeout(timeout);
  }

  timeout = setTimeout(() => {
    if (window.controller.wallet.isUnlocked()) {
      // window.controller.wallet.lock();
    }
  }, timer * 60 * 1000);
};

browser.runtime.onMessage.addListener(async ({ type, target }) => {
  if (type === 'autolock' && target === 'background') restartLockTimeout();
});

browser.runtime.onConnect.addListener(async (port: Runtime.Port) => {
  console.log('Checking portName', port);
  if (port.name === 'pali-inject') {
    window.controller.dapp.setup(port);

    return;
  }
  const { changingConnectedAccount } = store.getState().vault;
  if (changingConnectedAccount.isChangingConnectedAccount)
    window.controller.wallet.resolveAccountConflict();

  const senderUrl = port.sender.url;

  if (
    senderUrl?.includes(browser.runtime.getURL('/app.html')) ||
    senderUrl?.includes(browser.runtime.getURL('/external.html'))
  ) {
    sysweb3Di.getStateStorageDb().setPrefix('sysweb3-');
    sysweb3Di.useFetchHttpClient(window.fetch.bind(window));
    sysweb3Di.useLocalStorageClient(window.localStorage);

    window.controller.utils.setFiat();

    port.onDisconnect.addListener(() => {
      log('pali disconnecting port', 'System');
    });
  }
});

wrapStore(store, { portName: STORE_PORT });
