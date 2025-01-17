export const handleStartPolling = () => {
  chrome.runtime.sendMessage({ type: 'startPolling' });
};
