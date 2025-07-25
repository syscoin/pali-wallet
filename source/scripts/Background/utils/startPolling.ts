import store from 'state/store';
import { isTransactionInBlock } from 'utils/transactionUtils';

// Export the function so it can be imported elsewhere
export function getPollingInterval() {
  const {
    isBitcoinBased,
    accounts,
    activeAccount,
    activeNetwork,
    accountTransactions,
  } = store.getState().vault;

  // Check if there are pending transactions
  const currentAccount = accounts[activeAccount.type]?.[activeAccount.id];
  // Check if popup is open for more responsive updates
  const isPopupOpen = chrome.extension.getViews({ type: 'popup' }).length > 0;

  if (currentAccount) {
    const chain = isBitcoinBased ? 'syscoin' : 'ethereum';
    const transactions =
      accountTransactions[activeAccount.type]?.[activeAccount.id]?.[chain]?.[
        activeNetwork.chainId
      ] || [];
    const hasPendingTransactions =
      Array.isArray(transactions) &&
      transactions.some((tx: any) => !isTransactionInBlock(tx));

    // Use rapid polling when there are pending transactions
    if (hasPendingTransactions || isPopupOpen) {
      return isBitcoinBased ? 2 : 1; // Original intervals: 2 min for UTXO, 1 min for EVM
    }
  }

  // Slower polling when idle (no pending transactions)
  // This saves resources when wallet is just sitting idle
  return isBitcoinBased ? 5 : 3; // 5 min for UTXO, 3 min for EVM when idle
}

export async function startPolling() {
  // Use Chrome storage as a global lock across all background script instances
  const POLLING_LOCK_KEY = 'pali_polling_lock';
  const LOCK_TIMEOUT = 10000; // 10 seconds timeout
  const MAX_RETRIES = 2;

  // Add random delay to prevent race conditions between multiple instances
  const randomDelay = Math.floor(Math.random() * 150) + 75; // 75-225ms
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  try {
    // Check and set global lock with retry mechanism
    const lockResult = await new Promise<boolean>((resolve) => {
      let retryCount = 0;

      const attemptLock = () => {
        chrome.storage.local.get([POLLING_LOCK_KEY], (storageResult) => {
          if (chrome.runtime.lastError) {
            console.error(
              '[attemptLock] Storage error:',
              chrome.runtime.lastError
            );
            resolve(false);
            return;
          }
          const existing = storageResult[POLLING_LOCK_KEY];
          const now = Date.now();

          // If no lock exists or lock is expired, acquire it
          if (!existing || now - existing.timestamp > LOCK_TIMEOUT) {
            // Use a unique identifier to detect race conditions
            const lockId = `${chrome.runtime.id}-${now}-${Math.random()}`;
            chrome.storage.local.set(
              {
                [POLLING_LOCK_KEY]: {
                  timestamp: now,
                  instance: chrome.runtime.id,
                  lockId,
                },
              },
              () => {
                if (chrome.runtime.lastError) {
                  console.error(
                    '[attemptLock] Failed to set lock:',
                    chrome.runtime.lastError
                  );
                  resolve(false);
                  return;
                }

                // Double-check that we actually got the lock (detect race conditions)
                setTimeout(() => {
                  chrome.storage.local.get(
                    [POLLING_LOCK_KEY],
                    (doubleCheck) => {
                      if (chrome.runtime.lastError) {
                        console.error(
                          '[attemptLock] Double-check error:',
                          chrome.runtime.lastError
                        );
                        resolve(false);
                        return;
                      }
                      const currentLock = doubleCheck[POLLING_LOCK_KEY];
                      if (currentLock && currentLock.lockId === lockId) {
                        console.log(
                          `🔓 startPolling: Acquired global lock (attempt ${
                            retryCount + 1
                          }), proceeding`
                        );
                        resolve(true);
                      } else {
                        console.log(
                          `🔒 startPolling: Lost race condition (attempt ${
                            retryCount + 1
                          }), retrying...`
                        );
                        retryCount++;
                        if (retryCount < MAX_RETRIES) {
                          setTimeout(
                            attemptLock,
                            Math.floor(Math.random() * 250) + 150
                          ); // 150-400ms delay
                        } else {
                          console.log(
                            '🔒 startPolling: Max retries reached, skipping'
                          );
                          resolve(false);
                        }
                      }
                    }
                  );
                }, 12); // Small delay for double-check
              }
            );
          } else {
            console.log(
              `🔒 startPolling: Global lock held by another instance (attempt ${
                retryCount + 1
              }), skipping`
            );
            resolve(false);
          }
        });
      };

      attemptLock();
    });

    if (!lockResult) {
      return; // Another instance is handling polling
    }

    // Clear and recreate with new interval (needed to update polling frequency)
    chrome.alarms.clear('check_for_updates', () => {
      const interval = getPollingInterval();
      console.log(
        `🎯 startPolling: Creating polling alarm with ${interval} minute interval`
      );
      chrome.alarms.create('check_for_updates', {
        periodInMinutes: interval,
      });

      // Release global lock after alarm creation
      chrome.storage.local.remove([POLLING_LOCK_KEY], () => {
        if (chrome.runtime.lastError) {
          console.error(
            '[startPolling] Failed to remove lock:',
            chrome.runtime.lastError
          );
        }
      });
    });
  } catch (error) {
    console.error('Error in startPolling:', error);
    // Ensure lock is released even on error
    chrome.storage.local.remove([POLLING_LOCK_KEY], () => {
      if (chrome.runtime.lastError) {
        console.error(
          '[startPolling] Failed to remove lock on error:',
          chrome.runtime.lastError
        );
      }
    });
  }
}
