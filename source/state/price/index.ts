import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { IAssetPrice, IPriceState } from './types';

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
    rehydrate(state: IPriceState, action: PayloadAction<IPriceState>) {
      return {
        ...state,
        ...action.payload,
      };
    },
    setPrices(state: IPriceState, action: PayloadAction<IAssetPrice>) {
      state.fiat = action.payload;
    },
    setCoins(state: IPriceState, action: PayloadAction<any>) {
      state.coins = action.payload;
    },
  },
});

export const { setPrices, setCoins, rehydrate } = PriceState.actions;

export default PriceState.reducer;
