export const disable = (origin: string, isPendingWindow: () => boolean) => {
  const { dapp } = window.controller;
  const isConnected = dapp.isDAppConnected(origin);

  if (isPendingWindow() || !isConnected) return;

  dapp.userDisconnectDApp(origin);
};
