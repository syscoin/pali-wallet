import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import IPriceState from './types';

const initialState: IPriceState = {
  fiat: {},
};

// createSlice comes with immer produce so we don't need to take care of immutational update
const PriceState = createSlice({
  name: 'price',
  initialState,
  reducers: {
    updateFiatPrice(
      state: IPriceState,
      action: PayloadAction<{ assetId: string; price: number }>
    ) {
      state.fiat = {
        ...state.fiat,
        [action.payload.assetId]: action.payload.price,
      };
    },
  },
});

export const { updateFiatPrice } = PriceState.actions;

export default PriceState.reducer;
