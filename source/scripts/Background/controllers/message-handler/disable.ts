export const disable = (origin: string, isPendingWindow: () => boolean) => {
  const { dapp } = window.controller;
  const hasDApp = dapp.hasDApp(origin);

  if (isPendingWindow() || !hasDApp) return;

  dapp.disconnect(origin);
};
