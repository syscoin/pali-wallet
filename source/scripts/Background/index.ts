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
import { initializeOffscreenPreload } from 'scripts/Background/handlers/handleOffscreenPreload';
import { handleStartPolling } from 'scripts/Background/handlers/handleStartPolling';
import { handleObserveStateChanges } from 'scripts/Background/handlers/handleStateChanges';

import { IMasterController } from './controllers';
import { notificationManager } from './notification-manager';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

let MasterControllerInstance = {} as IMasterController;
let isReady = false;

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

    // Initialize notification manager after controller is ready
    console.log('[Background] Notification manager initialized');
    // The notification manager self-initializes and subscribes to state changes
  })
  .catch((error) => {
    console.error('[Background] Failed to initialize controller:', error);
  });

export const getController = () => MasterControllerInstance;
export const getIsReady = () => isReady;
export { notificationManager };

// Removed keep-alive port listener - Chrome alarms handle critical functions
