import { IMasterController } from 'scripts/Background/controllers';
export const handleLogout = (controller: IMasterController) => {
  controller.wallet.lock();

  // Send a message to the content script
  chrome.runtime.sendMessage({ action: 'logoutFS' });
};
