import 'emoji-log';
import { wrapStore } from 'webext-redux';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { sysweb3Di } from '@pollum-io/sysweb3-core';

import { STORE_PORT } from 'constants/index';
import store from 'state/store';
// import { localStorage } from 'redux-persist-webextension-storage';
import { setAccountTransactions, setActiveAccountProperty } from 'state/vault';
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
    handleLogout();
  }, timer * 60 * 1000);
};

const handleIsOpen = (isOpen: boolean) =>
  window.localStorage.setItem('isPopupOpen', JSON.stringify({ isOpen }));
const handleLogout = () => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listner will refresh timeout even if it's disabled
  if (isTimerEnabled) {
    window.controller.wallet.lock();

    window.location.replace('/');
  }
};

browser.runtime.onMessage.addListener(async ({ type, target }) => {
  if (type === 'reset_autolock' && target === 'background') {
    restartLockTimeout();
  }
});

export const inactivityTime = () => {
  const resetTimer = () => {
    browser.runtime.sendMessage({
      type: 'reset_autolock',
      target: 'background',
    });
  };

  // DOM Events
  const events = [
    'onmousemove',
    'onkeydown',
    'onload',
    'onmousedown',
    'ontouchstart',
    'onclick',
    'onkeydown',
  ];

  events.forEach((event) => (document[event] = resetTimer));
};

browser.runtime.onConnect.addListener(async (port: Runtime.Port) => {
  if (port.name === 'pali') handleIsOpen(true);
  if (port.name === 'pali-inject') {
    window.controller.dapp.setup(port);

    return;
  }
  const { changingConnectedAccount, timer, isTimerEnabled } =
    store.getState().vault;

  if (timeout) clearTimeout(timeout);

  if (isTimerEnabled) {
    timeout = setTimeout(() => {
      handleLogout();
    }, timer * 60 * 1000);
  }

  if (changingConnectedAccount.isChangingConnectedAccount)
    window.controller.wallet.resolveAccountConflict();

  const senderUrl = port.sender.url;

  if (
    senderUrl?.includes(browser.runtime.getURL('/app.html')) ||
    senderUrl?.includes(browser.runtime.getURL('/external.html'))
  ) {
    window.controller.utils.setFiat();

    sysweb3Di.getStateStorageDb().setPrefix('sysweb3-');
    sysweb3Di.useFetchHttpClient(window.fetch.bind(window));
    sysweb3Di.useLocalStorageClient(window.localStorage);

    port.onDisconnect.addListener(() => {
      handleIsOpen(false);
      if (timeout) clearTimeout(timeout);
      if (isTimerEnabled) {
        timeout = setTimeout(() => {
          handleLogout();
        }, timer * 60 * 1000);
      }
      log('pali disconnecting port', 'System');
    });
  }
});

// browser.runtime.onConnect.addListener(async () => {
//   const pollingEvmTxs =
//     await window.controller.wallet.transactions.evm.pollingEvmTransactions(
//       new ethers.providers.JsonRpcProvider(
//         store.getState().vault.activeNetwork.url
//       )
//     );
//   console.log('here background');

//   setTimeout(() => {
//     console.log('inside validation');
//     pollingEvmTxs;
//   }, 20000);
// });

async function checkForUpdates() {
  console.log('checkForUpdates');

  const vault = store.getState().vault;

  if (
    store.getState().vault.changingConnectedAccount
      .isChangingConnectedAccount ||
    store.getState().vault.isLoadingAssets ||
    store.getState().vault.isLoadingTxs
  ) {
    //also need to return if walle is unlocked
    console.log('return');
    return;
  }
  const activeAccountId = vault.activeAccount;
  const account = vault.accounts?.[activeAccountId];
  const isBitcoinBased = vault.isBitcoinBased;
  const network = vault.activeNetwork;

  if (isBitcoinBased) {
    console.log('await sys polling');
    const sysTx =
      await window.controller.wallet.transactions.sys.pollingSysTransactions(
        account.xpub,
        network.url
      );

    console.log('aftersystxfn', sysTx);
    if (sysTx?.length > 0) {
      console.log('sysTx if');
      store.dispatch(
        setActiveAccountProperty({
          property: 'transactions',
          value: sysTx,
        })
      );
    }
  } else {
    console.log('await evm polling');

    const evmTx =
      await window.controller.wallet.transactions.evm.pollingEvmTransactions(
        isBitcoinBased,
        account,
        network.url
      );

    console.log(evmTx);
    if (Object.values(evmTx)?.length > 0) {
      store.dispatch(setAccountTransactions(evmTx));
    }
  }
}

let intervalId;

chrome.runtime.onConnect.addListener((port) => {
  // execute checkForUpdates() every 5 seconds
  if (port.name === 'polling') {
    port.onMessage.addListener((message) => {
      console.log('polling');
      if (message.action === 'startPolling') {
        console.log('start polling');
        intervalId = setInterval(checkForUpdates, 10000);
        console.log('intervalId', intervalId);
        port.postMessage({ intervalId });
      } else if (message.action === 'stopPolling') {
        clearInterval(intervalId);
      }
    });
  }
});

const port = chrome.runtime.connect({ name: 'polling' });
port.postMessage({ action: 'startPolling' });

wrapStore(store, { portName: STORE_PORT });
