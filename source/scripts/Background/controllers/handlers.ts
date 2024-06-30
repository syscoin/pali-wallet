import { Store } from '@reduxjs/toolkit';
import { throttle } from 'lodash';

import { rehydrateStore } from 'state/rehydrate';
import store from 'state/store';
import { updateState } from 'state/store';

// eslint-disable-next-line no-shadow
export enum GlobalMessageEvent {
  rehydrate = 'rehydrate',
}

export const handleStoreSubscribe = (storeInside: Store) => {
  const listener = throttle(async () => {
    const notifyUpdate = await updateState();
    if (notifyUpdate) {
      await chrome.runtime.sendMessage(GlobalMessageEvent.rehydrate);
    }
  }, 1000);

  // Subscribe store to updates
  storeInside.subscribe(listener);
};

export const handleRehydrateMessage = async (message: any) => {
  if (message !== GlobalMessageEvent.rehydrate) return;

  await rehydrateStore(store);
};

export const handleRehydrateStore = () => {
  chrome.runtime.onMessage.addListener(handleRehydrateMessage);
};
