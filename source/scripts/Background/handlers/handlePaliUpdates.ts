import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import { isPollingRunNotValid } from 'scripts/Background/utils/isPollingRunNotValid';
import store from 'state/store';

export async function checkForUpdates() {
  const { activeAccount, isBitcoinBased, activeNetwork } =
    store.getState().vault;

  if (isPollingRunNotValid()) {
    return;
  }
  controllerEmitter(
    ['wallet', 'updateUserNativeBalance'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );

  controllerEmitter(
    ['wallet', 'updateUserTransactionsState'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );

  controllerEmitter(
    ['wallet', 'updateAssetsFromCurrentAccount'],
    [
      {
        isPolling: true,
        isBitcoinBased,
        activeNetwork,
        activeAccount,
      },
    ]
  );
}
