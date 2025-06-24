import 'emoji-log';

// Log immediately to show background script is starting
console.log(
  '[Background] Service worker starting at',
  new Date().toISOString()
);

import { handleFiatPrice } from 'scripts/Background/handlers/handleFiatPrice';
import { handleListeners } from 'scripts/Background/handlers/handleListeners';
import { handleMasterControllerInstance } from 'scripts/Background/handlers/handleMasterControllerInstance';
import { handleMasterControllerResponses } from 'scripts/Background/handlers/handleMasterControllerResponses';
import { handleOffscreenPreload } from 'scripts/Background/handlers/handleOffscreenPreload';
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

    // Start offscreen preload
    handleOffscreenPreload().catch((error) => {
      console.error('[Background] Failed to start offscreen preload:', error);
    });
  })
  .catch((error) => {
    console.error('[Background] Failed to initialize controller:', error);
  });

export const getController = () => MasterControllerInstance;

// Removed keep-alive port listener - Chrome alarms handle critical functions
