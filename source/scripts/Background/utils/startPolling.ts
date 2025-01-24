import store from 'state/store';

function getPollingInterval() {
  const { isBitcoinBased } = store.getState().vault;
  return isBitcoinBased ? 2 * 60 : 0.15;
}

export const startPolling = () => {
  chrome.alarms.create('check_for_updates', {
    periodInMinutes: getPollingInterval(),
  });
};
