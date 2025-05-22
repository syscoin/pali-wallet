import store from 'state/store';

// Export the function so it can be imported elsewhere
export function getPollingInterval() {
  const { isBitcoinBased } = store.getState().vault;
  // Increase polling intervals for better performance
  // EVM: 5 minutes, Bitcoin-based: 10 minutes
  return isBitcoinBased ? 10 : 5; // polling interval in minutes, minimum acceptable by chrome alarm API is 1
}

export const startPolling = () => {
  chrome.alarms.create('check_for_updates', {
    periodInMinutes: getPollingInterval(),
  });
};
