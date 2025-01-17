import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';
import store from 'state/store';

export const handleLogout = () => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listner will refresh timeout even if it's disabled

  if (isTimerEnabled) {
    controllerEmitter(['wallet', 'lock'], []);

    // Send a message to the content script
    chrome.runtime.sendMessage({ action: 'logoutFS' });
  }
};
