export const handleFiatPrice = () => {
  // We will set up the recurring alarm in handleListeners.ts
  // Trigger the first update shortly after launch.
  chrome.alarms.create('update_fiat_price_initial', { delayInMinutes: 0.1 });

  // The actual fetching will be done via masterController.utils.setFiat()
  // triggered by the alarm listener.
};
