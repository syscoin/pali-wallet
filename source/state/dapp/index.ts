import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { IDAppState, IDApp } from './types';

export const initialState: IDAppState = {
  dapps: {},
};

const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    rehydrate(state: IDAppState, action: PayloadAction<{ dapps: any }>) {
      return {
        ...state,
        ...action.payload,
      };
    },
    addDApp(state: IDAppState, action: PayloadAction<IDApp>) {
      state.dapps[action.payload.host] = action.payload;
    },

    updateDAppAccount(
      state: IDAppState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        date: number;
        host: string;
      }>
    ) {
      const { host, accountId, accountType, date } = action.payload;

      if (!state.dapps[host])
        throw new Error('Unable to update account. DApp does not exist');

      state.dapps[host].accountId = accountId;
      state.dapps[host].accountType = accountType;
      state.dapps[host].date = date;
    },

    removeDApp(state: IDAppState, action: PayloadAction<string>) {
      delete state.dapps[action.payload];
    },
  },
});

export const { rehydrate, addDApp, removeDApp, updateDAppAccount } =
  DAppState.actions;

export default DAppState.reducer;
