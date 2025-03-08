import { startPolling } from 'scripts/Background/utils/startPolling';
import store from 'state/store';

let currentState = store.getState();
let currentIsBitcoinBased = currentState.vault.isBitcoinBased;

export function handleObserveStateChanges() {
  // send initial state to popup
  chrome.runtime
    .sendMessage({
      type: 'CONTROLLER_STATE_CHANGE',
      data: currentState,
    })
    .catch(() => {
      // no-op
    });

  store.subscribe(() => {
    const nextState = store.getState();

    if (nextState.vault.isBitcoinBased !== currentIsBitcoinBased) {
      currentIsBitcoinBased = nextState.vault.isBitcoinBased;
      if (nextState.vault.isPolling) {
        startPolling();
      }
    }

    if (JSON.stringify(currentState) !== JSON.stringify(nextState)) {
      currentState = nextState;

      // send state changes to popup
      chrome.runtime
        .sendMessage({
          type: 'CONTROLLER_STATE_CHANGE',
          data: nextState,
        })
        .catch(() => {
          //no-op
        }); // ignore errors when sending message and the extension is closed
    }
  });
}
