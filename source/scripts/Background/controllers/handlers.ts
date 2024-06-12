import { Store } from '@reduxjs/toolkit';
import { throttle } from 'lodash';

import { updateState } from 'state/store';

// eslint-disable-next-line no-shadow
enum GlobalMessageEvent {
  rehydrate = 'rehydrate',
}

export const handleStoreSubscribe = (store: Store) => {
  const listener = throttle(async () => {
    const notifyUpdate = updateState();
    if (notifyUpdate) {
      await chrome.runtime.sendMessage(GlobalMessageEvent.rehydrate);
    }
  }, 1000);

  // Subscribe store to updates
  store.subscribe(listener);
};
