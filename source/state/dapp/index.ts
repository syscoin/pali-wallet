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
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      if (!state.listeners[origin]) state.listeners[origin] = [eventName];
      if (state.listeners[origin].includes(eventName)) return;

      state.listeners[origin].push(eventName);
    },

    removeListener(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      const index = state.listeners[origin].findIndex((e) => e === eventName);
      if (index === -1) return;

      state.listeners[origin].splice(index, 1);
    },

    removeListeners(state: IDAppState, action: PayloadAction<string>) {
      delete state.listeners[action.payload];
    },

    addDApp(state: IDAppState, action: PayloadAction<IDApp>) {
      state.dapps[action.payload.origin] = action.payload;
    },

    updateDAppAccount(
      state: IDAppState,
      action: PayloadAction<{ accountId: number; origin: string }>
    ) {
      const { origin, accountId } = action.payload;

      if (!state.dapps[origin])
        throw new Error('Unable to update account. DApp does not exist');

      state.dapps[origin].accountId = accountId;
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
