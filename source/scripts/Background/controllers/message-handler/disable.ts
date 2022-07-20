export const disable = (origin: string, isPendingWindow: () => boolean) => {
  const { dapp } = window.controller;
  const isConnected = dapp.isConnected(origin);

  if (isPendingWindow() || !isConnected) return;

  dapp.disconnect(origin);
};
