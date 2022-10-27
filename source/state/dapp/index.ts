import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDAppState, IDApp } from './types';

export const initialState: IDAppState = {
  dapps: {},
};

const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    addDApp(state: IDAppState, action: PayloadAction<IDApp>) {
      state.dapps[action.payload.host] = action.payload;
    },

    updateDAppAccount(
      state: IDAppState,
      action: PayloadAction<{ accountId: number; date: number; host: string }>
    ) {
      const { host, accountId, date } = action.payload;

      if (!state.dapps[host])
        throw new Error('Unable to update account. DApp does not exist');

      state.dapps[host].accountId = accountId;
      state.dapps[host].date = date;
    },

    removeDApp(state: IDAppState, action: PayloadAction<string>) {
      delete state.dapps[action.payload];
    },
  },
});

export const { addDApp, removeDApp, updateDAppAccount } = DAppState.actions;

export default DAppState.reducer;
