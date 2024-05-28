/* eslint-disable import/no-extraneous-dependencies */
import 'emoji-log';
import { wrapStore, Store } from '@eduardoac-skimlinks/webext-redux';
import { browser, Runtime } from 'webextension-polyfill-ts';

import { STORE_PORT } from 'constants/index';
import store from 'state/store';
import { setIsPolling } from 'state/vault';
import { TransactionsType } from 'state/vault/types';
// import { i18next } from 'utils/i18n';
import { parseJsonRecursively } from 'utils/format';
import { log } from 'utils/logger';
import { PaliLanguages } from 'utils/types';

import MasterController, { IMasterController } from './controllers';
import { IEvmTransactionResponse } from './controllers/transactions/types';
/* eslint-disable @typescript-eslint/ban-ts-comment */
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}
const isWatchRequestsActive = false;

let paliPort: Runtime.Port;
let paliPopupPort: Runtime.Port;

const masterController = MasterController();

export const getController = () => masterController;

const { wallet, dapp, utils } = getController();
setInterval(utils.setFiat, 3 * 60 * 1000);

const onWalletReady = () => {
  // Add any code here that depends on the initialized wallet
  if (paliPort) {
    dapp.setup(paliPort);
  }
  utils.setFiat();
};

onWalletReady();

browser.runtime.onInstalled.addListener(() => {
  console.emoji('🤩', 'Pali extension enabled');
});

async function createOffscreen() {
  await chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.BLOBS],
      justification: 'keep service worker running',
    })
    .catch(() => {});
}
chrome.runtime.onStartup.addListener(createOffscreen);
self.onmessage = () => null; // keepAlive
createOffscreen();

let timeout: any;

// const restartLockTimeout = () => {
//   const { timer } = store.getState().vault;

//   if (timeout) {
//     clearTimeout(timeout);
//   }

//   timeout = setTimeout(() => {
//     handleLogout();
//   }, timer * 60 * 1000);
// };

const handleIsOpen = (isOpen: boolean) =>
  browser.storage.local.set({ isPopupOpen: isOpen });

const handleLogout = () => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listner will refresh timeout even if it's disabled

  if (isTimerEnabled) {
    wallet.lock();

    // Send a message to the content script
    browser.runtime.sendMessage({ action: 'logoutFS' });
  }
};

browser.storage.onChanged.addListener((changes) => {
  console.log({ changes });
  console.log({
    formatted: parseJsonRecursively(changes?.['persist:root']?.newValue),
  });
});

let requestCount = 0;
const requestsPerSecond = {};
const requestCallback = (details: any) => {
  const {
    activeNetwork: { url },
  } = store.getState().vault;

  if (details.url.includes(url) && isWatchRequestsActive) {
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
    case 'ping':
      if (target === 'background')
        paliPopupPort?.postMessage({ action: 'pong' });
      break;
    case 'reset_autolock':
      // if (target === 'background') restartLockTimeout();
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
  console.log({ port });
  if (port.name === 'pali') {
    handleIsOpen(true);
    paliPopupPort = port;
  }
  if (port.name === 'pali-inject') {
    port.onMessage.addListener((message) => {
      if (message.action === 'isInjected') {
        const { hasEthProperty } = store.getState().vault;
        port.postMessage({ isInjected: hasEthProperty });
      }
    });
    if (dapp !== undefined) {
      dapp.setup(port);
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
    wallet.resolveAccountConflict();

  const senderUrl = port.sender.url;

  if (
    senderUrl?.includes(browser.runtime.getURL('/app.html')) ||
    senderUrl?.includes(browser.runtime.getURL('/external.html'))
  ) {
    port.onDisconnect.addListener(() => {
      // handleIsOpen(false);
      if (timeout) clearTimeout(timeout);
      if (isTimerEnabled) {
        timeout = setTimeout(() => {
          // handleLogout();
        }, timer * 60 * 1000);
      }
      log('pali disconnecting port', 'System');
    });
  }
});

async function checkForUpdates() {
  const { activeAccount, isBitcoinBased, activeNetwork } =
    store.getState().vault;

  if (isPollingRunNotValid()) {
    return;
  }

  //Method that update Balances for current user based on isBitcoinBased state ( validated inside )
  wallet.updateUserNativeBalance({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });

  //Method that update TXs for current user based on isBitcoinBased state ( validated inside )
  wallet.updateUserTransactionsState({
    isPolling: true,
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });

  //Method that update Assets for current user based on isBitcoinBased state ( validated inside )
  wallet.updateAssetsFromCurrentAccount({
    isPolling: true,
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  });
}

let stateIntervalId;
let pendingTransactionsPollingIntervalId;
let isListenerRegistered = false;
let currentIsBitcoinBased = store.getState().vault.isBitcoinBased;

function getPollingInterval() {
  const { isBitcoinBased } = store.getState().vault;
  return isBitcoinBased ? 2 * 60 * 1000 : 15 * 1000;
}

function startPolling() {
  clearInterval(stateIntervalId);
  stateIntervalId = setInterval(checkForUpdates, getPollingInterval());
}

function unregisterListener() {
  browser.runtime.onConnect.removeListener(handleConnect);
  isListenerRegistered = false;
}

function handleConnect(port) {
  const { isPolling } = store.getState().vault;

  if (port.name === 'polling') {
    port.onMessage.addListener((message) => {
      if (message.action === 'startPolling' && !isPolling) {
        store.dispatch(setIsPolling(true));
        startPolling();
        port.postMessage({ stateIntervalId });
      } else if (message.action === 'stopPolling') {
        clearInterval(stateIntervalId);
        store.dispatch(setIsPolling(false));
      }
    });
  } else if (port.name === 'pendingTransactionsPolling') {
    port.onMessage.addListener((message) => {
      if (message.action === 'startPendingTransactionsPolling') {
        store.dispatch(setIsPolling(true));
        startPendingTransactionsPolling();
      } else if (message.action === 'stopPendingTransactionsPolling') {
        clearInterval(pendingTransactionsPollingIntervalId);
        store.dispatch(setIsPolling(false));
      }
    });
  }
}

function registerListener() {
  if (isListenerRegistered) {
    return;
  }

  browser.runtime.onConnect.addListener(handleConnect);
  isListenerRegistered = true;
}

function observeVaultChanges() {
  store.subscribe(() => {
    const nextState = store.getState().vault;
    if (nextState.isBitcoinBased !== currentIsBitcoinBased) {
      currentIsBitcoinBased = nextState.isBitcoinBased;
      if (store.getState().vault.isPolling) {
        startPolling();
      }
      unregisterListener();
      registerListener();
    }
  });
}

function startPendingTransactionsPolling() {
  pendingTransactionsPollingIntervalId = setInterval(
    checkForPendingTransactionsUpdate,
    2 * 60 * 60 * 1000 //run after 2 hours
  );
}

async function checkForPendingTransactionsUpdate() {
  const { accounts, activeAccount, activeNetwork, isBitcoinBased } =
    store.getState().vault;

  if (isPollingRunNotValid() || isBitcoinBased) {
    return;
  }

  const currentAccountTransactions =
    (accounts[activeAccount.type]?.[activeAccount.id]?.transactions[
      TransactionsType.Ethereum
    ]?.[activeNetwork.chainId] as IEvmTransactionResponse[]) ?? [];

  const pendingTransactions = currentAccountTransactions?.filter(
    (transaction) => transaction.confirmations === 0
  );

  if (pendingTransactions.length === 0) {
    return;
  }

  const maxTransactionsToSend = 3;

  const cooldownTimeMs = 60 * 1000; //1 minute

  for (let i = 0; i < pendingTransactions.length; i += maxTransactionsToSend) {
    const batchTransactions = pendingTransactions.slice(
      i,
      i + maxTransactionsToSend
    );

    wallet.validatePendingEvmTransactions({
      activeNetwork,
      activeAccount,
      pendingTransactions: batchTransactions,
    });

    if (i + maxTransactionsToSend < pendingTransactions.length) {
      await new Promise((resolve) => setTimeout(resolve, cooldownTimeMs));
    }
  }
}

observeVaultChanges();
registerListener();

const port = browser.runtime.connect(undefined, { name: 'polling' });
port.postMessage({ action: 'startPolling' });

const secondPort = browser.runtime.connect(undefined, {
  name: 'pendingTransactionsPolling',
});
secondPort.postMessage({ action: 'startPendingTransactionsPolling' });

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

export const keepSWAlive = () => {
  browser.runtime.sendMessage({
    type: 'ping',
    target: 'background',
  });
};

export const resetPaliRequestsCount = () => {
  browser.runtime.sendMessage({
    type: 'resetPaliRequestsCount',
    target: 'background',
  });
};

export const setLanguageInLocalStorage = (lang: PaliLanguages) => {
  browser.storage.local.set({ language: lang });
};

wrapStore(store, { portName: STORE_PORT });

export { Store as ProxyStore };

const isPollingRunNotValid = () => {
  const {
    isNetworkChanging,
    isLoadingTxs,
    isLoadingBalances,
    isLoadingAssets,
    changingConnectedAccount: { isChangingConnectedAccount },
    accounts,
    lastLogin,
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

  return notValidToRunPolling;
};
