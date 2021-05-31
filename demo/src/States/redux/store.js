import {
  configureStore,
  getDefaultMiddleware,
  Store,
} from '@reduxjs/toolkit';
import userReducer from '../features/userSlice';

const middleware = [
  ...getDefaultMiddleware({ thunk: false, serializableCheck: false }),
];
const store = configureStore({
  reducer: {
    user: userReducer,
  }, middleware
});

export default store;
