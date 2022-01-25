import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDAppState, IDAppInfo } from './types';

const initialState: IDAppState = {
  listening: {},
  trustedApps: {},
};

const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    registerListeningSite(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      const originState = state.listening[origin]
        ? state.listening[origin].filter((val: string) => val !== eventName)
        : [];

      return {
        ...state,
        listening: {
          ...state.listening,
          [origin]: [...originState, eventName],
        },
      };
    },
    deregisterListeningSite(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      if (!state.listening[origin]) {
        return state;
      }

      const originState = state.listening[origin].filter(
        (val: string) => val !== eventName
      );

      const retState = {
        ...state,
        listening: {
          ...state.listening,
          [origin]: originState,
        },
      };

      if (originState.length === 0) {
        delete retState.listening[origin];
      }

      return retState;
    },
    listNewDapp(
      state: IDAppState,
      action: PayloadAction<{
        dapp: IDAppInfo;
        id: string;
        network: string;
      }>
    ) {
      return {
        ...state,
        whitelist: {
          ...state.trustedApps,
          [action.payload.id.replace(/(^\w+:|^)\/\//, '')]: {
            ...action.payload.dapp,
            id: action.payload.id.replace(/(^\w+:|^)\/\//, ''),
          },
        },
      };
    },
    unlistDapp(state: IDAppState, action: PayloadAction<{ id: string }>) {
      delete state.trustedApps[action.payload.id];
    },
  },
});

export const {
  listNewDapp,
  unlistDapp,
  registerListeningSite,
  deregisterListeningSite,
} = DAppState.actions;

export default DAppState.reducer;
