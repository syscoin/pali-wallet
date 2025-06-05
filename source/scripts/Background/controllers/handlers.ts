import { Store } from '@reduxjs/toolkit';
import { throttle } from 'lodash';

import { updateState } from 'state/store';

// eslint-disable-next-line no-shadow
export enum GlobalMessageEvent {
  rehydrate = 'rehydrate',
}

export const handleStoreSubscribe = (storeInside: Store) => {
  // Persist at most once every 3 seconds. This alone cuts storage I/O by ~66 %.
  const listener = throttle(
    async () => {
      // Just persist the state - no need to send rehydrate messages
      // State changes are already communicated via CONTROLLER_STATE_CHANGE
      await updateState();
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

// Note: The rehydrate message is intended for frontend components to sync with background state.
// The background script doesn't need to handle its own rehydrate messages.
// Frontend components (useRouterLogic, ExternalRoute) handle these via CONTROLLER_STATE_CHANGE.
