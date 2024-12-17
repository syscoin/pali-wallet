/* eslint-disable import/no-extraneous-dependencies */
import 'emoji-log';

import { INetwork } from '@pollum-io/sysweb3-network';

import { rehydrate as dappRehydrate } from 'state/dapp';
import { loadState } from 'state/paliStorage';
import { rehydrate as priceRehydrate } from 'state/price';
import store from 'state/store';
import { rehydrate as vaultRehydrate, setIsPolling } from 'state/vault';
import { TransactionsType } from 'state/vault/types';
import { log } from 'utils/logger';
import { chromeStorage } from 'utils/storageAPI';
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

let walletMethods = {} as any;
let dappMethods = {} as any;

let MasterControllerInstance = {} as IMasterController;

(async () => {
  const storageState = await loadState();
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

  utils.setFiat();
});

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

chrome.runtime.onMessage.addListener((message: any, _, sendResponse) => {
  const { type, data } = message;

  const isEventValid = type === 'CONTROLLER_ACTION';

  if (isEventValid) {
    const { methods, params, importMethod } = data;

    let targetMethod = MasterControllerInstance;

    for (const method of methods) {
      if (targetMethod && method in targetMethod) {
        targetMethod = targetMethod[method];
      } else {
        throw new Error('Method not found');
      }
    }

    if (typeof targetMethod === 'function' || importMethod) {
      new Promise(async (resolve) => {
        const response = importMethod
          ? targetMethod
          : await (targetMethod as any)(...params);

        resolve(response);
      }).then(sendResponse);
    } else {
      throw new Error('Method is not a function');
    }
  }

  return isEventValid;
});

chrome.runtime.onMessage.addListener(
  ({ type, target, data, action }, sender, sendResponse) => {
    const { isPolling, hasEthProperty } = store.getState().vault;
    switch (type) {
      case 'pw-msg-background':
        if (action === 'isInjected') {
          dappMethods.setup(sender);
          sendResponse({ isInjected: hasEthProperty });
        }
        break;
      case 'reset_autolock':
        if (target === 'background') restartLockTimeout();
        break;
      case 'lock_wallet':
        handleLogout();
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
      case 'startPolling':
        if (!isPolling) {
          store.dispatch(setIsPolling(true));
          startPolling();
          sendResponse({ stateIntervalId });
        }
        break;
      case 'stopPolling':
        clearInterval(stateIntervalId);
        store.dispatch(setIsPolling(false));
        break;
      case 'startPendingTransactionsPolling':
        store.dispatch(setIsPolling(true));
        startPendingTransactionsPolling();
        break;
      case 'stopPendingTransactionsPolling':
        clearInterval(pendingTransactionsPollingIntervalId);
        store.dispatch(setIsPolling(false));
        break;
    }
  }
);

chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === 'pali') {
    handleIsOpen(true);
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
      isPolling: true,
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
let currentState = store.getState();
let currentIsBitcoinBased = currentState.vault.isBitcoinBased;

function getPollingInterval() {
  const { isBitcoinBased } = store.getState().vault;
  return isBitcoinBased ? 2 * 60 * 1000 : 15 * 1000;
}

function startPolling() {
  clearInterval(stateIntervalId);
  stateIntervalId = setInterval(checkForUpdates, getPollingInterval());
}

function observeStateChanges() {
  // send initial state to popup
  chrome.runtime
    .sendMessage({
      type: 'CONTROLLER_STATE_CHANGE',
      data: currentState,
    })
    .catch(() => {});

  store.subscribe(() => {
    const nextState = store.getState();

    if (nextState.vault.isBitcoinBased !== currentIsBitcoinBased) {
      currentIsBitcoinBased = nextState.vault.isBitcoinBased;
      if (nextState.vault.isPolling) {
        startPolling();
      }
    }

    if (JSON.stringify(currentState) !== JSON.stringify(nextState)) {
      currentState = nextState;

      // send state changes to popup
      chrome.runtime
        .sendMessage({
          type: 'CONTROLLER_STATE_CHANGE',
          data: nextState,
        })
        .catch(() => {}); // ignore errors when sending message and the extension is closed
    }
  });
}

function startPendingTransactionsPolling() {
  pendingTransactionsPollingIntervalId = setInterval(
    checkForPendingTransactionsUpdate,
    60 * 1000 //run after 2 hours
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

const handleStartPolling = () => {
  chrome.runtime.sendMessage({ type: 'startPolling' });
};

const handlePendingTransactionsPolling = () => {
  chrome.runtime.sendMessage({ type: 'startPendingTransactionsPolling' });
};

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

export const setLanguageInLocalStorage = async (lang: PaliLanguages) => {
  try {
    const serializedState = JSON.stringify(lang);
    await chromeStorage.setItem('language', serializedState);
  } catch (e) {
    console.error('<!> Error saving language', e);
  }
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

  return (
    !hasAccount0Address ||
    verifyIfUserIsNotRegistered ||
    isChangingConnectedAccount ||
    isLoadingAssets ||
    isLoadingBalances ||
    isLoadingTxs ||
    isNetworkChanging
  );
};

observeStateChanges();
handleStartPolling();
handlePendingTransactionsPolling();
