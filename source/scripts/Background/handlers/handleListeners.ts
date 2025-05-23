import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import { checkForPendingTransactionsUpdate } from 'scripts/Background/utils/checkForPendingTransactions';
import { startPendingTransactionsPolling } from 'scripts/Background/utils/startPendingTransactionsPolling';
import {
  startPolling,
  getPollingInterval,
} from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

// Define the fiat update interval in minutes
const FIAT_UPDATE_INTERVAL_MINUTES = 3;

export const handleListeners = (masterController: IMasterController) => {
  // Called when the extension is first installed or updated
  chrome.runtime.onInstalled.addListener(() => {
    console.emoji('🤩', 'Pali extension enabled');
    // Setup recurring alarms upon installation/update
    chrome.alarms.create('check_for_updates', {
      periodInMinutes: getPollingInterval(), // Use the existing logic for main polling interval
    });
    chrome.alarms.create('check_pending_transactions', {
      periodInMinutes: 120, // Keep the 2-hour interval
    });
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL_MINUTES, // Setup recurring fiat price update
    });

    // Trigger initial updates immediately after installation/update
    checkForUpdates();
    checkForPendingTransactionsUpdate();
    masterController.wallet.setFiat(); // Initial fiat price fetch
  });

  // Called when the browser first starts
  chrome.runtime.onStartup.addListener(() => {
    console.emoji('🚀', 'Pali extension started');
    // Ensure alarms are set on browser startup as well (in case they were cleared)
    // Note: Alarms might persist depending on Chrome version/behavior, but recreating is safe.
    chrome.alarms.create('check_for_updates', {
      periodInMinutes: getPollingInterval(),
    });
    chrome.alarms.create('check_pending_transactions', {
      periodInMinutes: 120,
    });
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL_MINUTES,
    });

    // Trigger initial updates on startup
    checkForUpdates();
    checkForPendingTransactionsUpdate();
    masterController.wallet.setFiat();
  });

  // Listener for all alarms
  chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('Alarm triggered:', alarm.name);
    if (alarm.name === 'check_for_updates') {
      checkForUpdates();
    }

    if (alarm.name === 'check_pending_transactions') {
      checkForPendingTransactionsUpdate();
    }

    // Handle both initial and recurring fiat price alarms
    if (
      alarm.name === 'update_fiat_price' ||
      alarm.name === 'update_fiat_price_initial'
    ) {
      masterController.wallet.setFiat();
    }
  });

  chrome.runtime.onMessage.addListener(
    ({ type, data, action }, sender, sendResponse) => {
      const { hasEthProperty } = store.getState().vault;
      switch (type) {
        case 'pw-msg-background':
          if (action === 'isInjected') {
            masterController.dapp.setup(sender);

            sendResponse({ isInjected: hasEthProperty });
          }
          break;
        case 'lock_wallet':
          handleLogout(masterController);
          break;
        case 'changeNetwork':
          if (data) {
            masterController.wallet.setActiveNetwork(data.network);
          }
          break;
        case 'startPolling':
          startPolling();
          break;
        case 'startPendingTransactionsPolling':
          store.dispatch(setIsPolling(true));
          startPendingTransactionsPolling();
          break;
        case 'getCurrentState':
          sendResponse({ data: store.getState() });
          break;
      }
    }
  );
};
