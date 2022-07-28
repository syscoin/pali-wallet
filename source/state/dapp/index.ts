import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDAppState, IDApp } from './types';

export const initialState: IDAppState = {
  dapps: {},
  listeners: {},
};

const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    addListener(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; host: string }>
    ) {
      const { host, eventName } = action.payload;

      if (!state.listeners[host]) state.listeners[host] = [eventName];
      if (state.listeners[host].includes(eventName)) return;

      state.listeners[host].push(eventName);
    },

    removeListener(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; host: string }>
    ) {
      const { host, eventName } = action.payload;

      const index = state.listeners[host].findIndex((e) => e === eventName);
      if (index === -1) return;

      state.listeners[host].splice(index, 1);
    },

    removeListeners(state: IDAppState, action: PayloadAction<string>) {
      delete state.listeners[action.payload];
    },

    addDApp(state: IDAppState, action: PayloadAction<IDApp>) {
      state.dapps[action.payload.host] = action.payload;
    },

    updateDAppAccount(
      state: IDAppState,
      action: PayloadAction<{ accountId: number; host: string }>
    ) {
      const { host, accountId } = action.payload;

      if (!state.dapps[host])
        throw new Error('Unable to update account. DApp does not exist');

      state.dapps[host].accountId = accountId;
    },

    removeDApp(state: IDAppState, action: PayloadAction<string>) {
      delete state.dapps[action.payload];
    },
  },
});

export const {
  addDApp,
  removeDApp,
  updateDAppAccount,
  addListener,
  removeListener,
  removeListeners,
} = DAppState.actions;

export default DAppState.reducer;
