import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IAssetPrice, IPriceState } from './types';

export const initialState: IPriceState = {
  fiat: {
    asset: 'usd',
    price: 0,
  },
};

const PriceState = createSlice({
  name: 'price',
  initialState,
  reducers: {
    rehydrate(_state: IPriceState, action: PayloadAction<IPriceState>) {
      // Complete replacement - consistent with vault and vaultGlobal rehydration
      return action.payload;
    },
    setPrices(state: IPriceState, action: PayloadAction<IAssetPrice>) {
      state.fiat = action.payload;
    },
  },
});

export const { setPrices, rehydrate } = PriceState.actions;

export default PriceState.reducer;
