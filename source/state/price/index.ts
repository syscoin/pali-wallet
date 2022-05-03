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
    setPrices(state: IPriceState, action: PayloadAction<AssetPrice>) {
      state.fiat = action.payload;
    },
    setCoins(state: IPriceState, action: PayloadAction<any>) {
      state.coins = action.payload;
    },
  },
});

export const { setPrices, setCoins } = PriceState.actions;

export default PriceState.reducer;
