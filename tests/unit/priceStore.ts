// import { PRICE_SYS_ID } from 'constants/index';

// import reducer, { initialState, updatePrices } from 'state/price';

// describe('Price store actions', () => {
//   it('should return the initial state', () => {
//     expect(reducer(undefined, { type: undefined })).toEqual(initialState);
//   });

//   //* updateFiatPrice
//   it('should update fiat', () => {
//     const payload = {
//       fiat: {
//         asset: 'usd',
//         price: 123,
//       },
//     };

//     const newState = reducer(initialState, updatePrices(payload));

//     expect(newState.fiat).toEqual({
//       ...initialState.fiat,
//       [payload.assetId]: payload.price,
//       availableCoins: payload.availableCoins,
//       current: payload.current,
//     });
//   });
// });

export {};
