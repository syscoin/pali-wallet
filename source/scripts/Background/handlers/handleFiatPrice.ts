// This module handles fiat price updates through scheduled alarms
// The actual fetching will be done via masterController.wallet.setFiat()

export const handleFiatPrice = () => {
  // Clear any existing alarm before creating new one (prevents duplicates on restart)
  chrome.alarms.clear('update_fiat_price_initial', () => {
    // Trigger the first update shortly after launch
    chrome.alarms.create('update_fiat_price_initial', { delayInMinutes: 0.5 });
  });
};
