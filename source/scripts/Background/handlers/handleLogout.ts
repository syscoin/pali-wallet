import { IMasterController } from 'scripts/Background/controllers';
export const handleLogout = (controller: IMasterController) => {
  controller.wallet.lock();

  // Send a message to the frontend to handle logout navigation
  chrome.runtime.sendMessage({ type: 'logout' }, () => {
    // Ignore errors when popup is closed
    if (chrome.runtime.lastError) {
      // Expected when popup is closed - no action needed
    }
  });
};
