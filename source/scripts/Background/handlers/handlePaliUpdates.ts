import { getController } from '..';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import { saveState } from 'state/paliStorage';
import store from 'state/store';

// Cross-context deduplication using Chrome storage
const UPDATE_LOCK_KEY = 'checkForUpdates_lock';
const MIN_CHECK_INTERVAL = 1000; // 1 second minimum between checks

// Helper to acquire lock across all contexts (background script instances)
const acquireUpdateLock = async (): Promise<boolean> => {
  // Add random delay to prevent race conditions between multiple instances
  const randomDelay = Math.floor(Math.random() * 100) + 50; // 50-150ms
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  const now = Date.now();
  const instanceId = Math.random().toString(36).substr(2, 9);

  return new Promise((resolve) => {
    chrome.storage.local.get([UPDATE_LOCK_KEY], (result) => {
      const lockData = result[UPDATE_LOCK_KEY];

      // Check if lock exists and is still valid
      if (lockData && now - lockData.timestamp < MIN_CHECK_INTERVAL) {
        console.log(
          `⏸️ checkForUpdates: Another instance (${lockData.instanceId}) is checking or checked recently, skipping`
        );
        resolve(false);
        return;
      }

      // Acquire lock with instance tracking
      chrome.storage.local.set(
        {
          [UPDATE_LOCK_KEY]: {
            timestamp: now,
            instanceId: instanceId,
          },
        },
        () => {
          // Double-check we still have the lock after setting it
          chrome.storage.local.get([UPDATE_LOCK_KEY], (doubleCheckResult) => {
            const currentLock = doubleCheckResult[UPDATE_LOCK_KEY];
            if (currentLock && currentLock.instanceId === instanceId) {
              console.log(
                `🔒 checkForUpdates: Acquired lock, proceeding (instance: ${instanceId})`
              );
              resolve(true);
            } else {
              console.log(
                `⏸️ checkForUpdates: Lost lock race condition, another instance acquired it`
              );
              resolve(false);
            }
          });
        }
      );
    });
  });
};

// Helper to release lock
const releaseUpdateLock = () => {
  chrome.storage.local.remove([UPDATE_LOCK_KEY]);
};

export async function checkForUpdates(): Promise<boolean> {
  // Try to acquire cross-context lock
  const hasLock = await acquireUpdateLock();
  if (!hasLock) {
    console.log('⏸️ checkForUpdates: Another instance is checking, skipping');
    return false; // Return false to indicate we didn't acquire the lock
  }

  try {
    if (isPollingRunNotValid()) {
      console.log('⏸️ checkForUpdates: Polling run not valid, skipping');
      return true; // Return true since we acquired the lock (for startPolling responsibility)
    }

    // Skip all updates if we're on the hardware wallet page
    // Hardware wallet pages don't need balance/asset/transaction updates
    try {
      const tabs = await chrome.tabs.query({});
      const hasHardwareWalletTab = tabs.some((tab) =>
        tab.url?.includes('/settings/account/hardware')
      );
      if (hasHardwareWalletTab) {
        console.log(
          '⏸️ checkForUpdates: Skipping updates - hardware wallet page is open'
        );
        return true; // Return true since we acquired the lock
      }
    } catch (error) {
      // If we can't check the URL, continue with updates
      console.warn('[checkForUpdates] Could not check tab URLs:', error);
    }

    console.log('✅ checkForUpdates: Proceeding with update');

    // Always use direct controller call since we're already in the background
    // This avoids unnecessary errors when popup is closed
    try {
      await getController().wallet.getLatestUpdateForCurrentAccount(true);

      // Save state after successful update
      saveState(store.getState());
    } catch (error) {
      console.error('Error updating account in checkForUpdates:', error);
    }
  } catch (error) {
    console.error('Error in checkForUpdates:', error);
  } finally {
    // Always release the lock
    releaseUpdateLock();
  }

  return true; // Return true to indicate we acquired the lock
}
