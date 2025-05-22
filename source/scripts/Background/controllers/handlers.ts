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
  // Persist at most once every 3 seconds. This alone cuts storage I/O by ~66 %.
  const listener = throttle(
    async () => {
      const notifyUpdate = await updateState();
      if (notifyUpdate) {
        await chrome.runtime.sendMessage(GlobalMessageEvent.rehydrate);
      }
    },
    3000,
    {
      leading: false,
      trailing: true,
    }
  );

  // Subscribe store to updates
  storeInside.subscribe(listener);
};

export const handleRehydrateMessage = (message: any, _, sendResponse) => {
  if (message !== GlobalMessageEvent.rehydrate) return;

  new Promise(async (resolve) => {
    const response = await rehydrateStore(store);
    resolve(response);
  }).then(sendResponse);

  return true;
};

export const handleRehydrateStore = () => {
  chrome.runtime.onMessage.addListener(handleRehydrateMessage);
};
