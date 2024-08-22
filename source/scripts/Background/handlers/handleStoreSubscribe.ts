import { Store } from '@reduxjs/toolkit';
import { throttle } from 'lodash';

import {
  GlobalMessage,
  GlobalMessageEvent,
  MessageType,
} from '../messaging/types';
import { updateState } from 'state/store';

import { cacheConfig } from './handleRehydrateStore';

export const handleStoreSubscribe = (store: Store) => {
  const listener = throttle(async () => {
    if (cacheConfig.waitRehydrate) return;

    const notifyUpdate = await updateState();
    if (notifyUpdate) {
      const message: GlobalMessage = {
        type: MessageType.global,
        event: GlobalMessageEvent.rehydrate,
      };

      try {
        await chrome.runtime.sendMessage(message);
      } catch (err) {
        console.error(err);
        // NOOP
      }
    }
  }, 1000);

  // Subscribe store to updates
  store.subscribe(listener);
};
