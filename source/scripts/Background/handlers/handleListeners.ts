import { FIAT_UPDATE_INTERVAL } from '../constants';
import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import {
  startPolling,
  getPollingInterval,
} from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

export const handleListeners = (masterController: IMasterController) => {
  // Called when the extension is first installed or updated
  chrome.runtime.onInstalled.addListener(() => {
    console.emoji('🤩', 'Pali extension enabled');
    // Setup recurring alarms upon installation/update
    chrome.alarms.create('check_for_updates', {
      periodInMinutes: getPollingInterval(),
    });
    // Note: Removed separate pending transaction check - main update handles it now
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL,
    });

    // Trigger initial updates immediately after installation/update
    checkForUpdates();
    masterController.wallet.setFiat(); // Initial fiat price fetch
  });

  // Called when the browser first starts
  chrome.runtime.onStartup.addListener(() => {
    console.emoji('🚀', 'Pali extension started');
    // Ensure alarms are set on browser startup as well
    chrome.alarms.create('check_for_updates', {
      periodInMinutes: getPollingInterval(),
    });
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL,
    });

    // Trigger initial updates on startup
    checkForUpdates();
    masterController.wallet.setFiat();
  });

  // Listener for all alarms
  chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('Alarm triggered:', alarm.name);
    if (alarm.name === 'check_for_updates') {
      checkForUpdates();
      // Dynamically adjust polling interval based on current state
      startPolling();
    }

    // Handle fiat price updates
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
        case 'ping':
          // Health check ping - respond immediately to confirm the background script is alive
          sendResponse({ pong: true, timestamp: Date.now() });
          return true; // Keep message channel open for async response
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
          // Just trigger a regular update and restart polling with dynamic interval
          store.dispatch(setIsPolling(true));
          checkForUpdates();
          startPolling();
          break;
        case 'getCurrentState':
          sendResponse({ data: store.getState() });
          break;
        default:
          console.log('[Background] Unhandled message type:', type);
      }
    }
  );
};
