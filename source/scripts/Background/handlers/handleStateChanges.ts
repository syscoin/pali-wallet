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
          // Check for quota exceeded error
          if (chrome.runtime.lastError) {
            if (
              chrome.runtime.lastError.message?.includes('exceeded') ||
              chrome.runtime.lastError.message?.includes('quota') ||
              chrome.runtime.lastError.message?.includes('too large')
            ) {
              console.error(
                '[State] State too large to send:',
                chrome.runtime.lastError.message
              );
              // Could implement chunking or send minimal state here
            }
            // ignore other errors when extension is closed
          }
        }
      );
    }
  });
}
