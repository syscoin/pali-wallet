import { browser } from 'webextension-polyfill-ts';

/**
 * Opens a popup and adds events listener to resolve a promise.
 *
 * @param origin The dApp origin
 * @param route The popup route
 * @param eventName The event which will resolve the promise
 * @param data information that will be passed to the route. Optional
 *
 * @return either the event data or `{ success: boolean }`
 */
export const popupPromise = async ({
  data,
  eventName,
  origin,
  route,
}: {
  data?: object;
  eventName: string;
  origin: string;
  route: string;
}) => {
  const { dapp, createPopup } = window.controller;

  if (eventName !== 'connect' && !dapp.isConnected(origin)) return;
  if (dapp.hasWindow(origin)) return;

  const popup = await createPopup(route, { ...data, origin });
  dapp.setHasWindow(origin, true);

  return new Promise((resolve) => {
    window.addEventListener(
      eventName,
      (event: CustomEvent) => {
        if (event.detail.origin === origin) {
          if (event.detail.data !== undefined) {
            resolve(event.detail.data);
          }
          resolve({ success: true });
        }
      },
      { once: true, passive: true }
    );

    browser.windows.onRemoved.addListener((id) => {
      if (id === popup.id) {
        dapp.setHasWindow(origin, false);
        resolve({ success: false });
      }
    });
  });
};
