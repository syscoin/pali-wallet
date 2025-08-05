// This module handles fiat price updates through scheduled alarms
// The actual fetching will be done via masterController.wallet.setFiat()

import { fiatAlarmMutex } from 'utils/asyncMutex';

export const handleFiatPrice = async () =>
  // Use AsyncMutex for cross-context synchronization
  // This ensures only one instance creates the fiat price alarm
  fiatAlarmMutex.runExclusive(
    async () =>
      // Check if alarm already exists to prevent duplicates
      new Promise<void>((resolve) => {
        chrome.alarms.get('update_fiat_price_initial', (alarm) => {
          if (!alarm) {
            console.log(
              '🎯 handleFiatPrice: Creating initial fiat price update alarm'
            );
            chrome.alarms.create('update_fiat_price_initial', {
              delayInMinutes: 0.5,
            });
          } else {
            console.log(
              '🎯 handleFiatPrice: Fiat price alarm already exists, skipping duplicate creation'
            );
          }
          resolve();
        });
      })
  );
