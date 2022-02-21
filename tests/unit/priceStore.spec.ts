import { PRICE_SYS_ID } from 'constants/index';

import reducer, { initialState, updateFiatPrice } from 'state/price';

describe('Price store actions', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, { type: undefined })).toEqual(initialState);
  });

  //* updateFiatPrice
  it('should update fiat', () => {
    const payload = {
      assetId: PRICE_SYS_ID,
      availableCoins: {
        usd: 1.07,
      },
      current: 'brl',
      price: 5.92,
    };

    const newState = reducer(initialState, updateFiatPrice(payload));

    expect(newState.fiat).toEqual({
      ...initialState.fiat,
      [payload.assetId]: payload.price,
      availableCoins: payload.availableCoins,
      current: payload.current,
    });
  });
});
