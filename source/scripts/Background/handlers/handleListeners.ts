import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { startPolling } from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import vaultCache from 'state/vaultCache';

import { checkForUpdates } from './handlePaliUpdates';

// Flag to prevent duplicate listener registration
let listenersInitialized = false;

// Store listener references for cleanup
let alarmListener: ((alarm: chrome.alarms.Alarm) => void) | null = null;
let messageListener:
  | ((
      message: any,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => void)
  | null = null;

// Export for testing
export const resetListenersFlag = () => {
  listenersInitialized = false;
};

export const handleListeners = (masterController: IMasterController) => {
  // Prevent duplicate listener registration
  if (listenersInitialized) {
    console.log(
      '⚠️ handleListeners already initialized, skipping duplicate registration'
    );
    return;
  }

  console.log('🎧 Initializing listeners...');

  // Remove any existing listeners to prevent orphaned listeners
  // This is especially important with MV3 service workers that can restart
  if (alarmListener) {
    chrome.alarms.onAlarm.removeListener(alarmListener);
    console.log('🧹 Removed existing alarm listener');
  }
  if (messageListener) {
    chrome.runtime.onMessage.removeListener(messageListener);
    console.log('🧹 Removed existing message listener');
  }

  listenersInitialized = true;

  // Create and store alarm listener
  alarmListener = (alarm) => {
    console.log('Alarm triggered:', alarm.name);
    if (alarm.name === 'check_for_updates') {
      console.log('🎯 handleListeners: Processing check_for_updates alarm');
      checkForUpdates();
      // Just restart polling to adjust the alarm interval based on current state
      startPolling().catch((error) =>
        console.error('Error in startPolling:', error)
      );
    }

    // Handle fiat price updates - only the initial update since unlock/create wallet handle immediate updates
    if (alarm.name === 'update_fiat_price_initial') {
      masterController.wallet.setFiat();
    }

    // Handle auto-lock timer
    if (alarm.name === 'pali_auto_lock_timer') {
      console.log(
        '🔒 handleListeners: Auto-lock timer triggered, locking wallet'
      );
      masterController.wallet.lock();
    }
  };

  // Add the alarm listener
  chrome.alarms.onAlarm.addListener(alarmListener);

  // Create and store message listener
  messageListener = (message, sender, sendResponse) => {
    const { type, data, action } = message;
    const { hasEthProperty } = store.getState().vaultGlobal;

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
        startPolling().catch((error) =>
          console.error('Error in startPolling:', error)
        );
        break;
      case 'getCurrentState':
        sendResponse({ data: store.getState() });
        break;
      default:
        console.log('[Background] Unhandled message type:', type);
        return false; // Let other listeners handle this message
    }
  };

  // Add the message listener
  chrome.runtime.onMessage.addListener(messageListener);

  // 🚀 NEW: Port connection approach for popup close detection (no permissions needed)
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'popup-connection') {
      console.log('[Background] 🔌 Popup connected via port');
      port.onDisconnect.addListener(() => {
        console.log(
          '[Background] 🔌 Popup disconnected, triggering emergency save...'
        );
        // Trigger emergency save when popup closes
        vaultCache
          .emergencySave()
          .then(() => {
            console.log(
              '[Background] ✅ Emergency save completed after popup disconnect'
            );
          })
          .catch((error) => {
            console.error(
              '[Background] ❌ Emergency save failed after popup disconnect:',
              error
            );
          });
      });
    }
  });
};
