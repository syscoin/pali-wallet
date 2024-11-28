import store from 'state/store';

export const handleLogout = (walletMethods: any) => {
  const { isTimerEnabled } = store.getState().vault; // We need this because movement listener will refresh timeout even if it's disabled

  if (isTimerEnabled && walletMethods?.lock) {
    walletMethods.lock();

    // Send a message to the content script
    chrome.runtime.sendMessage({ action: 'logoutFS' });
  }
};
