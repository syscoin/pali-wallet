import { ethErrors } from 'helpers/errors';

import {
  ICustomEvent,
  IDAppController,
  PaliRoutes,
} from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import { getController } from 'scripts/Background';
import cleanErrorStack from 'utils/cleanErrorStack';

const TX_ROUTES = [
  PaliRoutes.SendEthTX,
  PaliRoutes.SendApprove,
  PaliRoutes.SendNTokenTX,
] as const;

const CHAIN_ROUTES = [
  PaliRoutes.SwitchEthChain,
  PaliRoutes.AddEthChain,
  PaliRoutes.SwitchUtxo,
] as const;

const REJECTION_ROUTES = new Set([
  PaliRoutes.SendEthTX,
  PaliRoutes.SendApprove,
  PaliRoutes.EthSign,
  PaliRoutes.EncryptKey,
  PaliRoutes.SwitchEthChain,
  PaliRoutes.AddEthChain,
  PaliRoutes.ChangeAccount,
  PaliRoutes.SwitchUtxo,
  PaliRoutes.WatchAsset,
  PaliRoutes.SwitchNetwork,
]);

const handleResponseEvent = async (
  event: ICustomEvent,
  eventName: string,
  host: string,
  route: PaliRoutes,
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

const handleCloseWindow = (
  popup: any,
  route: PaliRoutes,
  resolve: (value: unknown) => void
): void => {
  const handleWindowRemoval = (windowId: number): void => {
    if (windowId !== popup.id) {
      return;
    }

    if (REJECTION_ROUTES.has(route)) {
      resolve(cleanErrorStack(ethErrors.provider.userRejectedRequest()));
      return;
    }

    resolve({ success: false });
  };

  chrome.windows.onRemoved.addListener(handleWindowRemoval);
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
  route: string;
}) => {
  const { dapp, createPopup } = getController();

  if (await checkIfPopupIsOpen())
    throw cleanErrorStack(
      ethErrors.provider.unauthorized('Dapp already has a open window')
    );

  data = JSON.parse(JSON.stringify(data).replace(/#(?=\S)/g, ''));

  let popup = null;

  try {
    popup = await createPopup(route, { ...data, host, eventName });
  } catch (error) {
    throw error;
  }
  return new Promise((resolve) => {
    self.addEventListener('message', (swEvent) => {
      handleResponseEvent(
        swEvent,
        eventName,
        host,
        route as PaliRoutes,
        dapp,
        resolve
      );
      handleCloseWindow(popup, route as PaliRoutes, resolve);
    });
  });
};

function checkIfPopupIsOpen() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'isPopupOpen' }, (response) => {
      // Handle the case where popup is closed
      if (chrome.runtime.lastError) {
        // Popup is closed, so return false
        resolve(false);
      } else {
        resolve(response === true);
      }
    });
  });
}
