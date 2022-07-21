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

      const originState = Object.prototype.hasOwnProperty.call(
        state.listeners,
        origin
      )
        ? state.listeners[origin].filter((item: string) => item !== eventName)
        : [];

      return {
        ...state,
        listeners: {
          ...state.listeners,
          [origin]: [...originState, eventName],
        },
      };
    },
    removeListener(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      const hasOriginListening = Object.prototype.hasOwnProperty.call(
        state.listeners,
        origin
      );

      if (!hasOriginListening) return state;

      const originState = state.listeners[origin].filter(
        (val: string) => val !== eventName
      );

      const retState = {
        ...state,
        listeners: {
          ...state.listeners,
          [origin]: originState,
        },
      };

      if (originState.length === 0) {
        delete retState.listeners[origin];
      }

      return retState;
    },
    removeListeners(state: IDAppState, action: PayloadAction<string>) {
      delete state.listeners[action.payload];
    },
    addDApp(
      state: IDAppState,
      action: PayloadAction<{
        accountId: number;
        dapp: IDApp;
        id: string;
      }>
    ) {
      const { dapp, accountId, id } = action.payload;

      // TODO refactor
      return {
        ...state,
        dapps: {
          ...state.dapps,
          [id]: {
            id,
            ...dapp,
            accountId,
          },
        },
      };
    },
    removeDApp(state: IDAppState, action: PayloadAction<{ id: string }>) {
      delete state.dapps[action.payload.id];
    },
  },
});

export const {
  addDApp,
  removeDApp,
  addListener,
  removeListener,
  removeListeners,
} = DAppState.actions;

export default DAppState.reducer;
