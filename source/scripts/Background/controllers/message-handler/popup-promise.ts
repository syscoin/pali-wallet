import { ethErrors } from 'helpers/errors';

import { ICustomEvent, IDAppController } from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';

import { MethodRoute } from './types';

const TX_ROUTES = [
  MethodRoute.SendEthTx,
  MethodRoute.SendApprove,
  MethodRoute.SendNTokenTx,
] as const;

const CHAIN_ROUTES = [
  MethodRoute.SwitchEthChain,
  MethodRoute.AddEthChain,
  MethodRoute.SwitchUtxo,
] as const;

const REJECTION_ROUTES = new Set([
  MethodRoute.SendEthTx,
  MethodRoute.SendApprove,
  MethodRoute.EthSign,
  MethodRoute.EncryptKey,
  MethodRoute.SwitchEthChain,
  MethodRoute.AddEthChain,
  MethodRoute.ChangeAccount,
  MethodRoute.SwitchUtxo,
  MethodRoute.WatchAsset,
  MethodRoute.SwitchNetwork,
  // Note: Login is NOT in rejection routes - closing login window doesn't throw error
]);

const handleResponseEvent = async (
  event: ICustomEvent,
  eventName: string,
  host: string,
  route: MethodRoute,
  dapp: Readonly<IDAppController>,
  resolve: (value: unknown) => void
): Promise<void> => {
  const expectedEventName = `${eventName}.${host}`;

  if (event.data.eventName !== expectedEventName) {
    return;
  }

  if (CHAIN_ROUTES.includes(route as (typeof CHAIN_ROUTES)[number])) {
    resolve(null);
    return;
  }

  if (!event.data.detail) {
    return;
  }

  try {
    const parsedDetail = JSON.parse(event.data.detail);

    if (TX_ROUTES.includes(route as (typeof TX_ROUTES)[number])) {
      resolve(parsedDetail.hash);
      return;
    }

    resolve(parsedDetail);
  } catch (error) {
    console.error('Error parsing event detail:', error);
    throw new Error('Failed to parse event detail');
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
 * @return either the event data or `{ success: boolean }`
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

  return new Promise((resolve) => {
    let messageHandler: any = null;
    let windowRemovalHandler: any = null;

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

    // Message handler
    messageHandler = (swEvent: any) => {
      handleResponseEvent(
        swEvent,
        eventName,
        host,
        route,
        dapp,
        (result: any) => {
          cleanup();
          resolve(result);
        }
      );
    };

    // Window removal handler
    windowRemovalHandler = (windowId: number) => {
      if (windowId !== popup.id) {
        return;
      }

      cleanup();

      if (REJECTION_ROUTES.has(route)) {
        resolve(cleanErrorStack(ethErrors.provider.userRejectedRequest()));
      } else {
        resolve({ success: false });
      }
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
