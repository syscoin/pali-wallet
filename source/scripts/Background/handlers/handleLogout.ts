import { IMasterController } from 'scripts/Background/controllers';
export const handleLogout = (controller: IMasterController) => {
  controller.wallet.lock();

  // Send a message to the frontend to handle logout navigation
  chrome.runtime.sendMessage({ type: 'logout' });
};
