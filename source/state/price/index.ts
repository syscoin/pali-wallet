import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { AssetPrice, IPriceState } from './types';

export const initialState: IPriceState = {
  fiat: {
    asset: 'usd',
    price: 0,
  },
  coins: {},
};

const PriceState = createSlice({
  name: 'price',
  initialState,
  reducers: {
    updatePrices(
      state: IPriceState,
      action: PayloadAction<{
        fiat: AssetPrice;
      }>
    ) {
      const { fiat } = action.payload;

      state.fiat = fiat;
    },
  },
});

export const { updatePrices } = PriceState.actions;

export default PriceState.reducer;
