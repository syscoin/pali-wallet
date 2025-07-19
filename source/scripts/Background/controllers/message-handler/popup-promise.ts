import { ethErrors } from 'helpers/errors';

import { ICustomEvent, IDAppController } from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';

import { MethodRoute } from './types';

const handleResponseEvent = async (
  event: ICustomEvent,
  eventName: string,
  host: string,
  resolve: (value: unknown) => void
): Promise<void> => {
  const expectedEventName = `${eventName}.${host}`;
  if (event.data.eventName !== expectedEventName) {
    return;
  }

  // Always resolve with the actual data sent by the component
  if (event.data.detail) {
    try {
      const parsedDetail = JSON.parse(event.data.detail);
      resolve(parsedDetail);
    } catch (error) {
      console.error('Error parsing event detail:', error);
      resolve(null); // Fallback to null if parsing fails
    }
  } else {
    // Component sent a message but with no detail - resolve with null
    resolve(null);
  }
};

// Detection function for popup blocking - includes ALL extension windows that should block new popups
const checkForAnyOpenPopupOrHardwareWallet = async (): Promise<boolean> => {
  try {
    // Use only context detection since chrome.tabs.query doesn't give us URLs without tabs permission
    if (
      'getContexts' in chrome.runtime &&
      typeof chrome.runtime.getContexts === 'function'
    ) {
      return new Promise((resolve) => {
        (chrome.runtime as any).getContexts({}, (contexts: any[]) => {
          const ourExtensionOrigin = `chrome-extension://${chrome.runtime.id}`;

          const hasBlockingWindow = contexts.some((ctx) => {
            // Check for ANY tab from our extension (includes hardware wallet and external tabs)
            if (
              (ctx.contextType === 'TAB' || ctx.contextType === 'POPUP') &&
              ctx.documentOrigin === ourExtensionOrigin
            ) {
              return true;
            }

            return false;
          });

          resolve(hasBlockingWindow);
        });
      });
    }

    return false;
  } catch (error) {
    console.error('[checkForAnyOpenPopupOrHardwareWallet] Error:', error);
    return false;
  }
};

/**
 * Opens a popup and adds events listener to resolve a promise.
 *
 * @param host The dApp host
 * @param route The popup route
 * @param eventName The event which will resolve the promise.
 * The final event name is `eventName.host`
 * @param data information that will be passed to the route. Optional
 *
 * @return either the event data or `null` for success
 */
export const popupPromise = async ({
  data,
  eventName,
  host,
  route,
}: {
  data?: object;
  eventName: string;
  host: string;
  route: MethodRoute;
}) => {
  const { dapp, createPopup } = getController();

  // Use atomic check-and-set to prevent race conditions
  const canCreatePopup = await atomicCheckAndSetPopup();
  if (!canCreatePopup) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Dapp already has a open window')
    );
  }

  data = JSON.parse(JSON.stringify(data || {}).replace(/#(?=\S)/g, ''));

  let popup = null;

  try {
    popup = await createPopup(route, { ...data, host, eventName });
  } catch (error) {
    // Clear the flag if popup creation failed
    chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
    throw error;
  }

  return new Promise((resolve, reject) => {
    let messageHandler: any = null;
    let windowRemovalHandler: any = null;
    let resolved = false;

    // Clean up function to remove listeners
    const cleanup = () => {
      if (messageHandler) {
        self.removeEventListener('message', messageHandler);
        messageHandler = null;
      }
      if (windowRemovalHandler) {
        chrome.windows.onRemoved.removeListener(windowRemovalHandler);
        windowRemovalHandler = null;
      }
    };

    // Safe resolve function that prevents double resolution
    const safeResolve = (result: any) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      // Clear the storage flag when popup resolves (either success or cancelled)
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
      resolve(result);
    };

    // Message handler
    messageHandler = (swEvent: any) => {
      handleResponseEvent(swEvent, eventName, host, safeResolve);
    };

    // Window removal handler
    windowRemovalHandler = (windowId: number) => {
      if (windowId !== popup.id) {
        return;
      }

      // Clear the storage flag when popup closes
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);

      // Reject with user rejection error instead of resolving with null
      // This allows null to be used as a valid success response
      cleanup();
      resolved = true; // Mark as resolved to prevent double resolution
      reject(
        cleanErrorStack(
          ethErrors.provider.userRejectedRequest('User closed popup window')
        )
      );
    };

    // Add listeners
    self.addEventListener('message', messageHandler);
    chrome.windows.onRemoved.addListener(windowRemovalHandler);
  });
};

// Atomic check-and-set operation to prevent race conditions
function atomicCheckAndSetPopup(): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      // First check if there are any actual popup windows open (hardware wallet, etc.)
      const hasActualPopup = await checkForAnyOpenPopupOrHardwareWallet();
      if (hasActualPopup) {
        resolve(false);
        return;
      }

      // Then check storage flag
      chrome.storage.local.get(
        ['pali-popup-open', 'pali-popup-timestamp'],
        (result) => {
          if (chrome.runtime.lastError) {
            console.error(
              '[atomicCheckAndSetPopup] Storage error:',
              chrome.runtime.lastError
            );
            resolve(false);
            return;
          }

          const popupOpen = !!result['pali-popup-open'];
          const timestamp = result['pali-popup-timestamp'];
          const now = Date.now();

          if (popupOpen && timestamp) {
            // Check if timestamp is stale (older than 5 minutes)
            const STALE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

            if (now - timestamp > STALE_TIMEOUT) {
              // Stale flag - clear it and set new one atomically
              chrome.storage.local.set(
                {
                  'pali-popup-open': true,
                  'pali-popup-timestamp': now,
                },
                () => {
                  if (chrome.runtime.lastError) {
                    console.error(
                      '[atomicCheckAndSetPopup] Failed to set flag:',
                      chrome.runtime.lastError
                    );
                    resolve(false);
                  } else {
                    resolve(true);
                  }
                }
              );
              return;
            }

            // Storage flag is valid and recent - popup already exists
            resolve(false);
            return;
          }

          // No storage flag - set it atomically
          chrome.storage.local.set(
            {
              'pali-popup-open': true,
              'pali-popup-timestamp': now,
            },
            () => {
              if (chrome.runtime.lastError) {
                console.error(
                  '[atomicCheckAndSetPopup] Failed to set flag:',
                  chrome.runtime.lastError
                );
                resolve(false);
              } else {
                resolve(true);
              }
            }
          );
        }
      );
    } catch (error) {
      console.error(
        '[atomicCheckAndSetPopup] Error checking for actual popups:',
        error
      );
      resolve(false);
    }
  });
}
