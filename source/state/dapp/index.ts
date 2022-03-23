import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDAppState, IDAppInfo } from './types';

export const initialState: IDAppState = {
  listening: {},
  whitelist: {},
};

// createSlice comes with immer produce so we don't need to take care of immutational update
const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    registerListeningSite(
      state: IDAppState,
      action: PayloadAction<{ eventName: string; origin: string }>
    ) {
      const { origin, eventName } = action.payload;

      const originState = Object.prototype.hasOwnProperty.call(
        state.listening,
        origin
      )
        ? state.listening[origin].filter((item: string) => item !== eventName)
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

      const hasOriginListening = Object.prototype.hasOwnProperty.call(
        state.listening,
        origin
      );

      if (!hasOriginListening) return state;

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
      const { dapp, network } = action.payload;

      const id = action.payload.id.replace(/(^\w+:|^)\/\//, '');

      // Append to accounts if a network already exists
      let accountsByNetwork = {};
      if (state.whitelist[id]) {
        accountsByNetwork = {
          ...state.whitelist[id].accounts,
        };
      }

      return {
        ...state,
        whitelist: {
          ...state.whitelist,
          [id]: {
            id,
            ...dapp,
            accounts: {
              ...accountsByNetwork,
              [network]: dapp.accounts[network],
            },
          },
        },
      };
    },
    unlistDapp(state: IDAppState, action: PayloadAction<{ id: string }>) {
      delete state.whitelist[action.payload.id];
      delete state.listening[action.payload.id];
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
