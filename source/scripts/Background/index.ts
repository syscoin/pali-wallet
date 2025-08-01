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
import { startSpamFilterCleanup } from './controllers/spamFilterCleanup';
import { notificationManager } from './notification-manager';

declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window {
    controller: Readonly<IMasterController>;
  }
}

let MasterControllerInstance = {} as IMasterController;
let isReady = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 3;
const RETRY_DELAY = 2000; // 2 seconds

console.log('[Background] Initializing controller...');

// Start offscreen preload IMMEDIATELY - don't wait for controller
// This ensures the popup loads instantly when clicked
initializeOffscreenPreload().catch((error) => {
  console.error('[Background] Failed to initialize offscreen preload:', error);
});

// Initialize with retry logic
const initializeWithRetry = async (attempt = 1): Promise<void> => {
  try {
    console.log(
      `[Background] Initialization attempt ${attempt}/${MAX_INIT_ATTEMPTS}`
    );

    const controller = await handleMasterControllerInstance();
    MasterControllerInstance = controller;
    isReady = true;

    console.log(
      '[Background] Controller initialized successfully at',
      new Date().toISOString()
    );

    // Initialize all handlers
    handleMasterControllerResponses(controller);
    handleListeners(controller);
    handleObserveStateChanges();
    handleStartPolling();
    handleFiatPrice();

    // Start spam filter cleanup
    startSpamFilterCleanup();

    // Reset attempt counter on success
    initializationAttempts = 0;
  } catch (error) {
    console.error(
      `[Background] Initialization attempt ${attempt} failed:`,
      error
    );
    initializationAttempts = attempt;

    if (attempt < MAX_INIT_ATTEMPTS) {
      console.log(
        `[Background] Retrying initialization in ${RETRY_DELAY}ms...`
      );
      setTimeout(() => {
        initializeWithRetry(attempt + 1);
      }, RETRY_DELAY);
    } else {
      console.error(
        '[Background] Failed to initialize controller after all attempts.',
        'Entering degraded mode.'
      );

      // Set up a minimal controller that can handle initialization status checks
      // This will be handled by the existing message handler system
      MasterControllerInstance = {
        getInitializationStatus: () => ({
          isReady,
          attempts: initializationAttempts,
          maxAttempts: MAX_INIT_ATTEMPTS,
        }),
        retryInitialization: async () => {
          console.log('[Background] Manual retry requested');
          initializationAttempts = 0;
          await initializeWithRetry(1);
          return { retrying: true };
        },
      } as any;

      // Set up minimal handlers so the popup can check status
      handleMasterControllerResponses(MasterControllerInstance);
      handleListeners(MasterControllerInstance);
    }
  }
};

// Start initialization
initializeWithRetry(1);

export const getController = () => {
  if (!isReady) {
    throw new Error(
      'Controller not yet initialized. Please wait or retry initialization.'
    );
  }
  return MasterControllerInstance;
};

export const getIsReady = () => isReady;
export const getInitializationStatus = () => ({
  isReady,
  attempts: initializationAttempts,
  maxAttempts: MAX_INIT_ATTEMPTS,
});

export { notificationManager };

// Removed keep-alive port listener - Chrome alarms handle critical functions
