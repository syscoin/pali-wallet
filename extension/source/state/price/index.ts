import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface IFiatState {
  [assetId: string]: number;
  price: number;
  availableCoins: any,
  //@ts-ignore
  current: string | 'usd';
}

export interface IPriceState {
  fiat: IFiatState;
}

const initialState: {
  fiat: {
    [assetId: string]: number,
    price: number,
    availableCoins: any,
    //@ts-ignore
    current: string | 'usd',
  }
} = {
  //@ts-ignore
  fiat: {
    syscoin: 0,
    price: 0,
    availableCoins: {},
    current: 'usd',
  }
};

const PriceState = createSlice({
  name: 'price',
  initialState,
  reducers: {
    updateFiatPrice(
      state: IPriceState,
      action: PayloadAction<{
        assetId: string,
        price: number,
        availableCoins: any,
        current: string | 'usd',
      }>
    ) {
      state.fiat = {
        ...state.fiat,
        [action.payload.assetId]: action.payload.price,
        availableCoins: action.payload.availableCoins,
        current: action.payload.current || 'usd'
      };
    },
  },
});

export const { updateFiatPrice } = PriceState.actions;

export default PriceState.reducer;
