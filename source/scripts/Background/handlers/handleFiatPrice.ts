// This module handles fiat price updates through scheduled alarms
// The actual fetching will be done via masterController.wallet.setFiat()

export const handleFiatPrice = () => {
  // We will set up the recurring alarm in handleListeners.ts
  // Trigger the first update shortly after launch.
  chrome.alarms.create('update_fiat_price_initial', { delayInMinutes: 0.5 });
};
