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
        coins: any;
        fiat: AssetPrice;
      }>
    ) {
      const { fiat, coins } = action.payload;

      state.fiat = fiat;
      state.coins = coins;
    },
  },
});

export const { updatePrices } = PriceState.actions;

export default PriceState.reducer;
