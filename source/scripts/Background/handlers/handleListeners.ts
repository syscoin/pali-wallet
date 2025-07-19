import { onMessage } from '../controllers/message-handler';
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
    console.log(`Alarm triggered: ${alarm.name}`);

    if (alarm.name === 'check_for_updates') {
      console.log(`🎯 handleListeners: Processing check_for_updates alarm`);
      // Only the instance that acquired the checkForUpdates lock should call startPolling
      // This prevents duplicate alarm creation from multiple service worker instances
      checkForUpdates(true)
        .then((acquiredLock) => {
          // Only call startPolling if this instance acquired the lock
          // This ensures only one instance manages the alarm lifecycle
          if (acquiredLock) {
            startPolling().catch((pollError) =>
              console.error('Error in startPolling:', pollError)
            );
          }
        })
        .catch((error) => {
          // Log the error but don't stop - the alarm will continue
          console.error('Error in checkForUpdates:', error);
          // Even on error, if no other instance is handling it, ensure polling continues
          // by calling startPolling (it has its own lock to prevent duplicates)
          startPolling().catch((pollError) =>
            console.error(
              'Error in startPolling after checkForUpdates error:',
              pollError
            )
          );
        });
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
    // EMERGENCY FIX: Stop message loops immediately
    if (!message || typeof message !== 'object') {
      return false; // Silently drop malformed messages
    }

    const { type, data, action } = message;

    // EMERGENCY FIX: Drop all messages without types to prevent loops
    if (!type) {
      return false; // Silently drop malformed messages
    }

    const { hasEthProperty } = store.getState().vaultGlobal;

    // Handle DApp messages directly
    if (
      type === 'METHOD_REQUEST' ||
      type === 'ENABLE' ||
      type === 'DISABLE' ||
      type === 'IS_UNLOCKED'
    ) {
      // Handle DApp messages using the onMessage handler
      onMessage(message, sender)
        .then((response) => {
          if (response !== undefined) {
            sendResponse(response);
          } else {
            // Always send a response to avoid "message channel closed" errors
            sendResponse(null);
          }
        })
        .catch((error) => {
          console.error('[handleListeners] DApp message error:', error);
          sendResponse({
            error: {
              message: error.message || 'Internal error',
              code: error.code || -32603,
            },
          });
        });
      return true; // Indicate async response
    }

    // Let specialized handlers handle their message types
    if (
      type === 'CONTROLLER_ACTION' ||
      type === 'CONTROLLER_STATE_CHANGE' ||
      type === 'logout'
    ) {
      return false; // Let other listeners handle these
    }

    switch (type) {
      case 'pw-msg-background':
        if (action === 'isInjected') {
          masterController.dapp.setup(sender);
          sendResponse({ isInjected: hasEthProperty });
          return true; // Indicate async response
        }
        break;
      case 'lock_wallet':
        handleLogout(masterController);
        return false; // Synchronous, no response needed
      case 'changeNetwork':
        if (data) {
          masterController.wallet.setActiveNetwork(data.network);
        }
        return false; // Synchronous, no response needed
      case 'startPolling':
        startPolling().catch((pollError) =>
          console.error('Error in startPolling:', pollError)
        );
        return false; // Synchronous, no response needed
      case 'getCurrentState':
        // Send current state from background store
        const currentState = store.getState();
        sendResponse(currentState);
        return true; // Indicate async response
      // getCurrentState removed - background script automatically broadcasts state changes
      default:
        // Silently drop unknown message types to prevent spam
        return false;
    }

    return false;
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
          .catch((saveError) => {
            console.error(
              '[Background] ❌ Emergency save failed after popup disconnect:',
              saveError
            );
          });
      });
    }
  });
};
