import store from 'state/store';

let currentState = store.getState();

export function handleObserveStateChanges() {
  store.subscribe(() => {
    const nextState = store.getState();
    // Use simple reference equality - Redux creates new state objects on changes
    // This is much more efficient than JSON.stringify comparison
    if (currentState !== nextState) {
      currentState = nextState;

      // send state changes to popup
      chrome.runtime.sendMessage(
        {
          type: 'CONTROLLER_STATE_CHANGE',
          data: nextState,
        },
        () => {
          // ignore errors when sending message and the extension is closed
          if (chrome.runtime.lastError) {
            // no-op
          }
        }
      );
    }
  });
}
