import { IMasterController } from 'scripts/Background/controllers';
import { handleLogout } from 'scripts/Background/handlers/handleLogout';
import { checkForUpdates } from 'scripts/Background/handlers/handlePaliUpdates';
import { checkForPendingTransactionsUpdate } from 'scripts/Background/utils/checkForPendingTransactions';
import { startPendingTransactionsPolling } from 'scripts/Background/utils/startPendingTransactionsPolling';
import { startPolling } from 'scripts/Background/utils/startPolling';
import store from 'state/store';
import { setIsPolling } from 'state/vault';

export const handleListeners = (masterController: IMasterController) => {
  chrome.runtime.onInstalled.addListener(() => {
    console.emoji('🤩', 'Pali extension enabled');
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'check_for_updates') {
      checkForUpdates();
    }

    if (alarm.name === 'check_pending_transactions') {
      checkForPendingTransactionsUpdate();
    }
  });

  chrome.runtime.onMessage.addListener(
    ({ type, data, action }, sender, sendResponse) => {
      const { hasEthProperty } = store.getState().vault;
      switch (type) {
        case 'pw-msg-background':
          if (action === 'isInjected') {
            masterController.dapp.setup(sender);

            sendResponse({ isInjected: hasEthProperty });
          }
          break;
        case 'lock_wallet':
          handleLogout(masterController);
          break;
        case 'changeNetwork':
          if (data) {
            masterController.wallet.setActiveNetwork(
              data.network,
              data.isBitcoinBased ? 'syscoin' : 'ethereum'
            );
          }
          break;
        case 'startPolling':
          startPolling();
          break;
        case 'startPendingTransactionsPolling':
          store.dispatch(setIsPolling(true));
          startPendingTransactionsPolling();
          break;
        case 'getCurrentState':
          sendResponse({ data: store.getState() });
          break;
      }
    }
  );
};
