/** Re-run bootstrap so routing cannot reuse a pre-creation wallet snapshot. */
export const reloadWalletForRecovery = () => {
  window.location.replace(chrome.runtime.getURL('app.html'));
};
