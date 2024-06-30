/* eslint-disable import/no-extraneous-dependencies */
import 'emoji-log';

import { INetwork } from '@pollum-io/sysweb3-network';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { loadState } from 'state/paliStorage';
import { rehydrate as priceRehydrate } from 'state/price';
import store from 'state/store';
import { rehydrate as vaultRehydrate, setIsPolling } from 'state/vault';
import { TransactionsType } from 'state/vault/types';
// import { i18next } from 'utils/i18n';
import { parseJsonRecursively } from 'utils/format';
import { log } from 'utils/logger';
import { PaliLanguages } from 'utils/types';

import MasterController, { IMasterController } from './controllers';
import {
  handleRehydrateStore,
  handleStoreSubscribe,
} from './controllers/handlers';
import { IEvmTransactionResponse } from './controllers/transactions/types';

/* eslint-disable @typescript-eslint/ban-ts-comment */
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}
let paliPort: chrome.runtime.Port;
let paliPopupPort: chrome.runtime.Port;
let dappMethods = {} as any;
let walletMethods = {} as any;

// rehydrateStore(store).then(() => {});
let MasterControllerInstance = {} as IMasterController;
(async () => {
  const storageState = await loadState();
  console.log({ storageState });
  if (storageState) {
    store.dispatch(vaultRehydrate(storageState.vault));
    store.dispatch(dappRehydrate(storageState.dapp));
    store.dispatch(priceRehydrate(storageState.price));
  }
})().then(() => {
  const masterController = MasterController(store);
  MasterControllerInstance = masterController;

  const { wallet, dapp, utils } = masterController;

  dappMethods = dapp;
  walletMethods = wallet;

  setInterval(utils.setFiat, 3 * 60 * 1000);

  if (paliPort) {
    dapp.setup(paliPort);
  }
  utils.setFiat();
});

handleRehydrateStore();

const isWatchRequestsActive = false;

export const getController = () => MasterControllerInstance;

chrome.runtime.onInstalled.addListener(() => {
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
  chrome.storage.local.set({ isPopupOpen: isOpen });

const handleLogout = () => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listner will refresh timeout even if it's disabled

  if (isTimerEnabled && walletMethods?.lock) {
    walletMethods.lock();

    // Send a message to the content script
    chrome.runtime.sendMessage({ action: 'logoutFS' });
  }
};

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
  chrome.webRequest.onCompleted.addListener(requestCallback, { urls: [] });
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

chrome.runtime.onMessage.addListener(async ({ type, target, data }) => {
  switch (type) {
    case 'ping':
      if (target === 'background')
        paliPopupPort?.postMessage({ action: 'pong' });
      break;
    case 'reset_autolock':
      // if (target === 'background') restartLockTimeout();
      break;
    case 'changeNetwork':
      if (walletMethods?.setActiveNetwork && data) {
        walletMethods?.setActiveNetwork(
          data?.network,
          data?.isBitcoinBased ? 'syscoin' : 'ethereum'
        );
      }
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
        chrome.webRequest.onCompleted.removeListener(requestCallback);
      break;
  }
});

export const inactivityTime = () => {
  const resetTimer = () => {
    chrome.runtime.sendMessage({
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

chrome.runtime.onConnect.addListener(async (port) => {
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

    if (dappMethods !== undefined) {
      dappMethods.setup(port);
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

  if (
    changingConnectedAccount.isChangingConnectedAccount &&
    walletMethods?.resolveAccountConflict
  )
    walletMethods.resolveAccountConflict();

  const senderUrl = port.sender.url;

  if (
    senderUrl?.includes(chrome.runtime.getURL('/app.html')) ||
    senderUrl?.includes(chrome.runtime.getURL('/external.html'))
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
  if (
    walletMethods?.updateUserNativeBalance &&
    walletMethods?.updateAssetsFromCurrentAccount &&
    walletMethods?.updateUserTransactionsState
  ) {
    walletMethods.updateUserNativeBalance({
      isBitcoinBased,
      activeNetwork,
      activeAccount,
    });

    //Method that update TXs for current user based on isBitcoinBased state ( validated inside )
    walletMethods.updateUserTransactionsState({
      isPolling: true,
      isBitcoinBased,
      activeNetwork,
      activeAccount,
    });

    //Method that update Assets for current user based on isBitcoinBased state ( validated inside )
    walletMethods.updateAssetsFromCurrentAccount({
      isPolling: true,
      isBitcoinBased,
      activeNetwork,
      activeAccount,
    });
  }

  //Method that update Balances for current user based on isBitcoinBased state ( validated inside )
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
  chrome.runtime.onConnect.removeListener(handleConnect);
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

  chrome.runtime.onConnect.addListener(handleConnect);
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
    if (walletMethods?.validatePendingEvmTransactions) {
      walletMethods?.validatePendingEvmTransactions({
        activeNetwork,
        activeAccount,
        pendingTransactions: batchTransactions,
      });
    }

    if (i + maxTransactionsToSend < pendingTransactions.length) {
      await new Promise((resolve) => setTimeout(resolve, cooldownTimeMs));
    }
  }
}

observeVaultChanges();
registerListener();

const port = chrome.runtime.connect(undefined, { name: 'polling' });
port.postMessage({ action: 'startPolling' });

const secondPort = chrome.runtime.connect(undefined, {
  name: 'pendingTransactionsPolling',
});
secondPort.postMessage({ action: 'startPendingTransactionsPolling' });

export const verifyPaliRequests = () => {
  chrome.runtime.sendMessage({
    type: 'verifyPaliRequests',
    target: 'background',
  });
};

export const removeVerifyPaliRequestListener = () => {
  chrome.runtime.sendMessage({
    type: 'removeVerifyPaliRequestListener',
    target: 'background',
  });
};

export const keepSWAlive = () => {
  chrome.runtime.sendMessage({
    type: 'ping',
    target: 'background',
  });
};

export const resetPaliRequestsCount = () => {
  chrome.runtime.sendMessage({
    type: 'resetPaliRequestsCount',
    target: 'background',
  });
};

export const dispatchChangeNetworkBgEvent = (
  network: INetwork,
  isBitcoinBased: boolean
) => {
  chrome.runtime.sendMessage({
    type: 'changeNetwork',
    target: 'background',
    data: { network, isBitcoinBased },
  });
};

export const setLanguageInLocalStorage = (lang: PaliLanguages) => {
  chrome.storage.local.set({ language: lang });
};

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
