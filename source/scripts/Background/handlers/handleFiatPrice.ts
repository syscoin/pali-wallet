// This module handles fiat price updates through scheduled alarms
// The actual fetching will be done via masterController.wallet.setFiat()

export const handleFiatPrice = async () => {
  const ALARM_INIT_LOCK_KEY = 'pali_fiat_alarm_init_lock';
  const LOCK_TIMEOUT = 10000; // 10 seconds timeout
  const MAX_RETRIES = 2;

  // Add random delay to prevent race conditions between multiple instances
  const randomDelay = Math.floor(Math.random() * 200) + 100; // 100-300ms
  await new Promise((resolve) => setTimeout(resolve, randomDelay));

  // Use Chrome storage as a global lock across all background script instances
  const lockAcquired = await new Promise<boolean>((resolve) => {
    let retryCount = 0;

    const attemptLock = () => {
      chrome.storage.local.get([ALARM_INIT_LOCK_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.error(
            '[attemptLock] Storage error:',
            chrome.runtime.lastError
          );
          resolve(false);
          return;
        }
        const existing = result[ALARM_INIT_LOCK_KEY];
        const now = Date.now();

        // If no lock exists or lock is expired, acquire it
        if (!existing || now - existing.timestamp > LOCK_TIMEOUT) {
          const lockId = `${chrome.runtime.id}-${now}-${Math.random()}`;
          chrome.storage.local.set(
            {
              [ALARM_INIT_LOCK_KEY]: {
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

              // Double-check that we actually got the lock
              setTimeout(() => {
                chrome.storage.local.get(
                  [ALARM_INIT_LOCK_KEY],
                  (doubleCheck) => {
                    if (chrome.runtime.lastError) {
                      console.error(
                        '[attemptLock] Double-check error:',
                        chrome.runtime.lastError
                      );
                      resolve(false);
                      return;
                    }
                    const currentLock = doubleCheck[ALARM_INIT_LOCK_KEY];
                    if (currentLock && currentLock.lockId === lockId) {
                      console.log(
                        `🎯 handleFiatPrice: Acquired global lock for alarm initialization (attempt ${
                          retryCount + 1
                        })`
                      );
                      resolve(true);
                    } else {
                      console.log(
                        `🎯 handleFiatPrice: Lost race condition (attempt ${
                          retryCount + 1
                        }), retrying...`
                      );
                      retryCount++;
                      if (retryCount < MAX_RETRIES) {
                        setTimeout(
                          attemptLock,
                          Math.floor(Math.random() * 300) + 200
                        ); // 200-500ms delay
                      } else {
                        console.log(
                          '🎯 handleFiatPrice: Max retries reached, skipping alarm initialization'
                        );
                        resolve(false);
                      }
                    }
                  }
                );
              }, 15); // Small delay for double-check
            }
          );
        } else {
          console.log(
            `🎯 handleFiatPrice: Global lock held by another instance (attempt ${
              retryCount + 1
            }), skipping alarm initialization`
          );
          resolve(false);
        }
      });
    };

    attemptLock();
  });

  if (!lockAcquired) {
    return; // Another instance is handling alarm initialization
  }

  // Check if alarm already exists to prevent duplicates
  chrome.alarms.get('update_fiat_price_initial', (alarm) => {
    if (!alarm) {
      console.log(
        '🎯 handleFiatPrice: Creating initial fiat price update alarm'
      );
      chrome.alarms.create('update_fiat_price_initial', {
        delayInMinutes: 0.5,
      });
    } else {
      console.log(
        '🎯 handleFiatPrice: Fiat price alarm already exists, skipping duplicate creation'
      );
    }

    // Release lock after alarm check/creation
    chrome.storage.local.remove([ALARM_INIT_LOCK_KEY], () => {
      if (chrome.runtime.lastError) {
        console.error(
          '[handleFiatPrice] Failed to remove lock:',
          chrome.runtime.lastError
        );
      }
    });
  });
};
