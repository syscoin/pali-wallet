import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IDAppState, IDApp } from './types';

export const initialState: IDAppState = {
  dapps: {},
  pendingOrigins: [],
};

const DAppState = createSlice({
  name: 'dapp',
  initialState,
  reducers: {
    rehydrate(_state: IDAppState, action: PayloadAction<IDAppState>) {
      // Complete replacement - consistent with vault and vaultGlobal rehydration
      return action.payload;
    },
    addDApp(state: IDAppState, action: PayloadAction<IDApp>) {
      state.dapps[action.payload.host] = action.payload;
    },

    removeDApp(state: IDAppState, action: PayloadAction<string>) {
      delete state.dapps[action.payload];
    },
  },
  extraReducers: (builder) => {
    // Permissions belong to the removed wallet, not reusable account slots.
    // The recovery journal rehydrates the prior grant set if reset rolls back.
    builder.addCase('vault/forgetWallet', () => initialState);
  },
});

export const { addDApp, removeDApp, rehydrate } = DAppState.actions;

export default DAppState.reducer;
