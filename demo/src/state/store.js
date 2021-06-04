import { configureStore, getDefaultMiddleware } from "@reduxjs/toolkit";
import logger from "redux-logger";
import wallet from "./wallet";

const middleware = [
  ...getDefaultMiddleware({ thunk: true, serializableCheck: false }),
];

if (process.env.NODE_ENV !== "production") {
  middleware.push(logger);
}

const store = configureStore({
  reducer: wallet,
  middleware,
  devTools: process.env.NODE_ENV !== "production",
  // preloadedState: loadState()
});

export default store;
