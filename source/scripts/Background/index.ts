import 'emoji-log';

// Check if this is a restart
const startTime = new Date().toISOString();
const isRestart = globalThis.__PALI_BACKGROUND_INITIALIZED__ === true;
globalThis.__PALI_BACKGROUND_INITIALIZED__ = true;

// Log immediately to show background script is starting
console.log(
  isRestart
    ? '[Background] Service worker RESTARTING at'
    : '[Background] Service worker starting at',
  startTime
);
if (isRestart) {
  console.log(
    '[Background] ⚠️ This is a service worker restart - Chrome terminated the previous instance'
  );
}

import { handleFiatPrice } from 'scripts/Background/handlers/handleFiatPrice';
import { handleListeners } from 'scripts/Background/handlers/handleListeners';
import { handleMasterControllerInstance } from 'scripts/Background/handlers/handleMasterControllerInstance';
import { handleMasterControllerResponses } from 'scripts/Background/handlers/handleMasterControllerResponses';
import { initializeOffscreenPreload } from 'scripts/Background/handlers/handleOffscreenPreload';
import { handleStartPolling } from 'scripts/Background/handlers/handleStartPolling';
import { handleObserveStateChanges } from 'scripts/Background/handlers/handleStateChanges';

import { IMasterController } from './controllers';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

let MasterControllerInstance = {} as IMasterController;
let isReady = false;

// Handle ping messages immediately
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'ping') {
    sendResponse({ ready: isReady });
    return false; // Synchronous response
  }
  return false; // Let other handlers process non-ping messages
});

console.log('[Background] Initializing controller...');

// Start offscreen preload IMMEDIATELY - don't wait for controller
// This ensures the popup loads instantly when clicked
initializeOffscreenPreload().catch((error) => {
  console.error('[Background] Failed to initialize offscreen preload:', error);
});

handleMasterControllerInstance()
  .then((controller) => {
    MasterControllerInstance = controller;
    isReady = true;
    console.log(
      '[Background] Controller initialized successfully at',
      new Date().toISOString()
    );

    handleMasterControllerResponses(controller);
    handleListeners(controller);
    handleObserveStateChanges();
    handleStartPolling();
    handleFiatPrice();
  })
  .catch((error) => {
    console.error('[Background] Failed to initialize controller:', error);
  });

export const getController = () => MasterControllerInstance;

// Removed keep-alive port listener - Chrome alarms handle critical functions
