// import {
//   configureStore,
//   getDefaultMiddleware,
//   Store,
// } from '@reduxjs/toolkit';
// import userReducer from '../features/userSlice';

// const middleware = [
//   ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
// ];

// const store = configureStore({
//   reducer: {
//     user: userReducer,
//   }, middleware
// });

// export default store;

import {
  configureStore,
  getDefaultMiddleware
} from '@reduxjs/toolkit';
import logger from 'redux-logger';
import { loadState, saveState } from './localStorage';
import wallet from './wallet';
import throttle from 'lodash/throttle';

const middleware = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];

if (process.env.NODE_ENV !== 'production') {
  middleware.push(logger);
}

const store = configureStore({
  reducer: wallet,
  middleware,
  devTools: process.env.NODE_ENV !== 'production',
  // preloadedState: loadState()
});

// store.subscribe(
//   throttle(() => {
//     const state = store.getState();

//     saveState({
//       wallet: state
//     });
//   }, 1000)
// )

export default store;
