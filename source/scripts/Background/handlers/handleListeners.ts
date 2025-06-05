import { FIAT_UPDATE_INTERVAL } from '../constants';
import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { startPolling } from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

export const handleListeners = (masterController: IMasterController) => {
  // Called when the extension is first installed or updated
  chrome.runtime.onInstalled.addListener(() => {
    console.emoji('🤩', 'Pali extension enabled');
    // Setup recurring alarms upon installation/update
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL,
    });

    // Delay initial updates to allow proper initialization
    setTimeout(() => {
      masterController.wallet.setFiat(); // Initial fiat price fetch
      // Set up polling - this will call checkForUpdates() internally
      startPolling();
    }, 1000); // 1 second delay
  });

  // Called when the browser first starts
  chrome.runtime.onStartup.addListener(() => {
    console.emoji('🚀', 'Pali extension started');
    // Ensure alarms are set on browser startup as well
    chrome.alarms.create('update_fiat_price', {
      periodInMinutes: FIAT_UPDATE_INTERVAL,
    });

    // Delay initial updates to allow proper initialization
    setTimeout(() => {
      masterController.wallet.setFiat();
      // Set up polling - this will call checkForUpdates() internally
      startPolling();
    }, 1000); // 1 second delay
  });

  // Listener for all alarms
  chrome.alarms.onAlarm.addListener((alarm) => {
    console.log('Alarm triggered:', alarm.name);
    if (alarm.name === 'check_for_updates') {
      // Just restart polling - this will call checkForUpdates() internally and adjust interval
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

      // Let specialized handlers handle their message types
      if (
        type === 'CONTROLLER_ACTION' ||
        type === 'CONTROLLER_STATE_CHANGE' ||
        type === 'logout' ||
        type === 'isPopupOpen'
      ) {
        return false; // Let other listeners handle these
      }

      // Handle malformed messages
      if (!type) {
        console.warn('[Background] Received message with undefined type:', {
          data,
          action,
        });
        return false;
      }

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
          // startPolling() will call checkForUpdates() internally
          startPolling();
          break;
        case 'getCurrentState':
          sendResponse({ data: store.getState() });
          break;
        default:
          console.log('[Background] Unhandled message type:', type);
          return false; // Let other listeners handle this message
      }
    }
  );
};
