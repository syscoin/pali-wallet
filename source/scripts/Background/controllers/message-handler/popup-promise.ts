import { ethErrors } from 'helpers/errors';

import { ICustomEvent } from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';
import { hasExternalWalletPage } from 'utils/extensionContexts';

import {
  assertRequestActive,
  isRequestDocumentLive,
  requestCancelledError,
} from './request-lifetime';
import { MethodRoute } from './types';

const handleResponseEvent = async (
  event: ICustomEvent,
  eventName: string,
  host: string,
  approvalId: string,
  resolve: (value: unknown) => void,
  sender?: chrome.runtime.MessageSender,
  onStale?: () => void
): Promise<void> => {
  const expectedEventName = `${eventName}.${host}`;
  // A different extension view must not resolve this approval. The browser
  // supplies Client.url; page-controlled message fields cannot substitute it.
  try {
    const sourceUrl = new URL((event as any).source?.url);
    const expectedUrl = new URL(chrome.runtime.getURL('external.html'));
    const sourceData = JSON.parse(sourceUrl.searchParams.get('data') || '{}');
    if (
      sourceUrl.protocol !== expectedUrl.protocol ||
      sourceUrl.host !== expectedUrl.host ||
      sourceUrl.pathname !== expectedUrl.pathname ||
      sourceData.approvalId !== approvalId
    )
      return;
  } catch {
    return;
  }
  if (event.data.eventName !== expectedEventName) {
    return;
  }

  if (!(await isRequestDocumentLive(sender))) {
    onStale?.();
    return;
  }

  // Always resolve with the actual data sent by the component
  if (event.data.detail) {
    try {
      const parsedDetail = JSON.parse(event.data.detail);
      resolve(parsedDetail);
    } catch (error) {
      console.error('Error parsing event detail:', error);
      onStale?.(); // Malformed approval data must never count as acceptance.
    }
  } else {
    // Component sent a message but with no detail - resolve with null
    resolve(null);
  }
};

// Ordinary wallet tabs may stay open while a dapp requests approval.
// External approval/hardware views serialize prompts. Detection is bounded and
// failure is handled by atomicCheckAndSetPopup without opening another window.
const checkForAnyOpenPopupOrHardwareWallet = () => hasExternalWalletPage(2000);

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
  signal,
  sender,
}: {
  data?: object;
  eventName: string;
  host: string;
  route: MethodRoute;
  sender?: chrome.runtime.MessageSender;
  signal?: AbortSignal;
}) => {
  assertRequestActive(signal);
  if (!(await isRequestDocumentLive(sender))) throw requestCancelledError();
  const { createPopup } = getController();
  const approvalId = crypto.randomUUID();

  // Use atomic check-and-set to prevent race conditions
  const canCreatePopup = await atomicCheckAndSetPopup();
  if (!canCreatePopup) {
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Dapp already has a open window')
    );
  }

  // URLSearchParams in createPopup escapes the payload without changing it.
  data = data || {};

  let popup = null;

  try {
    popup = await createPopup(route, { ...data, host, eventName, approvalId });
  } catch (error) {
    // Clear the flag if popup creation failed
    chrome.storage.local.remove(
      ['pali-popup-open', 'pali-popup-timestamp'],
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            '[popup-promise] Failed to remove flags on error:',
            chrome.runtime.lastError
          );
        }
      }
    );
    throw error;
  }

  return new Promise((resolve, reject) => {
    let messageHandler: any = null;
    let windowRemovalHandler: any = null;
    let resolved = false;
    let onAbort: (() => void) | null = null;
    let livenessInterval: ReturnType<typeof setInterval> | null = null;
    let checkingLiveness = false;

    // Clean up function to remove listeners
    const cleanup = () => {
      if (livenessInterval) clearInterval(livenessInterval);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
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
      chrome.storage.local.remove(
        ['pali-popup-open', 'pali-popup-timestamp'],
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              '[popup-promise] Failed to remove flags on resolve:',
              chrome.runtime.lastError
            );
          }
        }
      );
      resolve(result);
    };

    // Message handler
    messageHandler = (swEvent: any) => {
      handleResponseEvent(
        swEvent,
        eventName,
        host,
        approvalId,
        safeResolve,
        sender,
        () => onAbort?.()
      );
    };

    // Window removal handler
    windowRemovalHandler = (windowId: number) => {
      if (windowId !== popup.id) {
        return;
      }

      // Clear the storage flag when popup closes
      chrome.storage.local.remove(
        ['pali-popup-open', 'pali-popup-timestamp'],
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              '[popup-promise] Failed to remove flags on window close:',
              chrome.runtime.lastError
            );
          }
        }
      );

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

    onAbort = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
      // Closing an approval rejects it; cancellation never authorizes a request.
      chrome.windows.remove(popup.id, () => {
        void chrome.runtime.lastError;
      });
      reject(requestCancelledError());
    };

    // Add listeners
    self.addEventListener('message', messageHandler);
    chrome.windows.onRemoved.addListener(windowRemovalHandler);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (sender?.documentId && !resolved) {
      livenessInterval = setInterval(async () => {
        if (checkingLiveness || resolved) return;
        checkingLiveness = true;
        try {
          if (!(await isRequestDocumentLive(sender))) onAbort?.();
        } finally {
          checkingLiveness = false;
        }
      }, 1000);
    }
  });
};

// Atomic check-and-set operation to prevent race conditions
function atomicCheckAndSetPopup(): Promise<boolean> {
  return new Promise((resolve) => {
    // First check if there are any actual popup windows open (hardware wallet, etc.)
    checkForAnyOpenPopupOrHardwareWallet()
      .then((hasActualPopup) => {
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
                console.warn(
                  '[atomicCheckAndSetPopup] Stale popup flag detected, clearing and proceeding'
                );
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
      })
      .catch((error) => {
        console.error(
          '[atomicCheckAndSetPopup] Error checking for actual popups:',
          error
        );
        resolve(false);
      });
  });
}
