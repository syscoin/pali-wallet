import reducer, { initialState, setCoins, setPrices } from 'state/price';

describe('Price store actions', () => {
  it('should return the initial state', () => {
    expect(reducer(undefined, { type: undefined })).toEqual(initialState);
  });

  //* setPrices
  it('should update fiat', () => {
    const payload = {
      asset: 'usd',
      price: 2.53,
    };

    const newState = reducer(initialState, setPrices(payload));

    expect(newState.fiat).toEqual(payload);
  });

  //* setCoins
  it('should update fiat', () => {
    const payload = {
      brl: 1.07,
      usd: 2.53,
    };

    const newState = reducer(initialState, setCoins(payload));

    expect(newState.coins).toEqual(payload);
  });
});
