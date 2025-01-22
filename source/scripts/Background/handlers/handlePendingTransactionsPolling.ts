export const handlePendingTransactionsPolling = () => {
  chrome.runtime.sendMessage({ type: 'startPendingTransactionsPolling' });
};
