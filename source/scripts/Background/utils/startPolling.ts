import store from 'state/store';

function getPollingInterval() {
  const { isBitcoinBased } = store.getState().vault;
  return isBitcoinBased ? 2 : 1; // polling interval in minutes, minimum acceptable by chrome alarm API is 1
}

export const startPolling = () => {
  chrome.alarms.create('check_for_updates', {
    periodInMinutes: getPollingInterval(),
  });
};
