import 'emoji-log';
import { wrapStore } from 'webext-redux';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { STORE_PORT } from 'constants/index';
import store from 'state/store';
import { setIsPolling } from 'state/vault';
import { log } from 'utils/logger';

import MasterController, { IMasterController } from './controllers';
/* eslint-disable @typescript-eslint/ban-ts-comment */
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}
const isWatchRequestsActive =
  // @ts-ignore
  browser.runtime.getManifest().environment?.WATCH_REQUESTS !== undefined &&
  // @ts-ignore
  browser.runtime.getManifest().environment?.WATCH_REQUESTS === 'active';
let paliPort: Runtime.Port;
const onWalletReady = (windowController: IMasterController) => {
  // Add any code here that depends on the initialized wallet
  window.controller = windowController;
  setInterval(window.controller.utils.setFiat, 3 * 60 * 1000);
  if (paliPort) {
    window.controller.dapp.setup(paliPort);
  }
  window.controller.utils.setFiat();
};

if (!window.controller) {
  window.controller = MasterController(onWalletReady);
  // setInterval(window.controller.utils.setFiat, 3 * 60 * 1000);
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

    // Send a message to the content script
    browser.runtime.sendMessage({ action: 'logoutFS' });
  }
};

let requestCount = 0;
const requestsPerSecond = {};
const requestCallback = (details: any) => {
  const {
    activeNetwork: { url },
  } = store.getState().vault;

  if (details.url === url && isWatchRequestsActive) {
    requestCount++;
    console.log('Request count:', requestCount);
  }

  // track all requests
  const currentTime = Math.floor(Date.now() / 1000);
  if (!requestsPerSecond[currentTime]) {
    requestsPerSecond[currentTime] = [];
  }

  requestsPerSecond[currentTime].push(details);
};

const verifyAllPaliRequests = () => {
  // get all requests called by extension
  browser.webRequest.onCompleted.addListener(requestCallback, { urls: [] });
};

// update and show requests per second
const updateRequestsPerSecond = () => {
  const { isBitcoinBased } = store.getState().vault;
  if (
    !isBitcoinBased &&
    process.env.NODE_ENV === 'development' &&
    isWatchRequestsActive
  ) {
    const currentTime = Math.floor(Date.now() / 1000);
    const requestCountPerSecond = requestsPerSecond[currentTime]?.length || 0;
    console.log('Requests per second:', requestCountPerSecond);

    if (requestsPerSecond[currentTime]) {
      console.log('//---------REQUESTS IN THIS SECOND---------//');
      requestsPerSecond[currentTime].forEach((request: any, index: number) => {
        console.log(`Request ${index + 1}:`, request);
      });
      console.log('//----------------------------------------//');
    }

    requestsPerSecond[currentTime] = [];
  }
};

// Interval to perform the information update and display the requests per second every second.
setInterval(updateRequestsPerSecond, 1000);

browser.runtime.onMessage.addListener(async ({ type, target }) => {
  switch (type) {
    case 'reset_autolock':
      if (target === 'background') restartLockTimeout();
      break;
    case 'verifyPaliRequests':
      if (target === 'background' && process.env.NODE_ENV === 'development')
        verifyAllPaliRequests();
      break;
    case 'resetPaliRequestsCount':
      if (target === 'background' && process.env.NODE_ENV === 'development')
        requestCount = 0;
      break;
    case 'removeVerifyPaliRequestListener':
      if (target === 'background' && process.env.NODE_ENV === 'development')
        browser.webRequest.onCompleted.removeListener(requestCallback);
      break;
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
    if (window.controller?.dapp) {
      window.controller.dapp.setup(port);
    }
    paliPort = port;
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
    // window.controller.utils.setFiat();

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

async function checkForUpdates() {
  const {
    changingConnectedAccount: { isChangingConnectedAccount },
    isLoadingAssets,
    isLoadingBalances,
    isLoadingTxs,
    isNetworkChanging,
    lastLogin,
    accounts,
    activeAccount,
    isBitcoinBased,
    activeNetwork,
  } = store.getState().vault;

  const verifyIfUserIsNotRegistered = lastLogin === 0;

  const hasAccount0Address = Boolean(accounts.HDAccount[0].address);

  const notValidToRunPolling =
    !hasAccount0Address ||
    verifyIfUserIsNotRegistered ||
    isChangingConnectedAccount ||
    isLoadingAssets ||
    isLoadingBalances ||
    isLoadingTxs ||
    isNetworkChanging;

  if (notValidToRunPolling) {
    //todo: do we also need to return if walle is unlocked?
    return;
  }

  //Method that update Balances for current user based on isBitcoinBased state ( validated inside )
  window.controller.wallet.updateUserNativeBalance({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });

  //Method that update TXs for current user based on isBitcoinBased state ( validated inside )
  window.controller.wallet.updateUserTransactionsState({
    isPolling: true,
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });

  //Method that update Assets for current user based on isBitcoinBased state ( validated inside )
  window.controller.wallet.updateAssetsFromCurrentAccount({
    isPolling: true,
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });
}

let intervalId;
let isListenerRegistered = false;

function registerListener() {
  if (isListenerRegistered) {
    return;
  }

  browser.runtime.onConnect.addListener((port) => {
    const isPolling = store.getState().vault.isPolling;
    store.dispatch(setIsPolling(false));

    if (port.name === 'polling') {
      port.onMessage.addListener((message) => {
        if (message.action === 'startPolling' && !isPolling) {
          store.dispatch(setIsPolling(true));
          intervalId = setInterval(checkForUpdates, 15000);
          port.postMessage({ intervalId });
        } else if (message.action === 'stopPolling') {
          clearInterval(intervalId);
          store.dispatch(setIsPolling(false));
        }
      });
    }
  });

  isListenerRegistered = true;
}

registerListener();

const port = browser.runtime.connect(undefined, { name: 'polling' });
port.postMessage({ action: 'startPolling' });

browser.runtime.onMessage.addListener(({ action }) => {
  if (action === 'resetPolling') {
    const pollingPort = browser.runtime.connect(undefined, { name: 'polling' });

    isListenerRegistered = false;
    pollingPort.postMessage({ action: 'stopPolling' });
    pollingPort.postMessage({ action: 'startPolling' });
  }
});

export const resetPolling = () => {
  browser.runtime.sendMessage({ action: 'resetPolling' });
};

export const verifyPaliRequests = () => {
  browser.runtime.sendMessage({
    type: 'verifyPaliRequests',
    target: 'background',
  });
};

export const removeVerifyPaliRequestListener = () => {
  browser.runtime.sendMessage({
    type: 'removeVerifyPaliRequestListener',
    target: 'background',
  });
};

export const resetPaliRequestsCount = () => {
  browser.runtime.sendMessage({
    type: 'resetPaliRequestsCount',
    target: 'background',
  });
};

wrapStore(store, { portName: STORE_PORT });
