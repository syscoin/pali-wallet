import { IMasterController } from 'scripts/Background/controllers';
import store from 'state/store';

export const handleLogout = (controller: IMasterController) => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listner will refresh timeout even if it's disabled

  if (isTimerEnabled) {
    controller.wallet.lock();

    // Send a message to the content script
    chrome.runtime.sendMessage({ action: 'logoutFS' });
  }
};
