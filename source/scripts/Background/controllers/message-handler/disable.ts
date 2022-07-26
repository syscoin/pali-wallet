/**
 * Disconnects the DApp
 *
 * Keeps the listeners
 */
export const disable = (origin: string) => {
  const { dapp } = window.controller;
  const hasDApp = dapp.hasDApp(origin);

  if (dapp.hasWindow(origin) || !hasDApp) return;

  dapp.disconnect(origin);
};
