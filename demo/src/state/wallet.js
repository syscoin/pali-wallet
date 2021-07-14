import { createSlice } from "@reduxjs/toolkit";

export const walletConnection = createSlice({
  name: "walletConnection",
  initialState: {
    isInstalled: false,
    isLocked: true,
    canConnect: false,
    connectedAccountData: {
      balance: 0,
      connectedAccount: null,
      connectedAccountAddress: "",
    },
    controller: null,
    connected: false,
  },
  reducers: {
    setIsInstalled: (state, action) => {
      return {
        ...state,
        isInstalled: action.payload,
      };
    },
    updateConnectedAccountData: (state, action) => {
      return {
        ...state,
        connectedAccountData: {
          balance: action.payload.balance,
          connectedAccount: action.payload.connectedAccount,
          connectedAccountAddress: action.payload.connectedAccountAddress,
        },
      };
    },
    setIsLocked: (state, action) => {
      return {
        ...state,
        isLocked: action.payload,
      };
    },
    setController: (state, action) => {
      return {
        ...state,
        controller: action.payload,
      };
    },
    setIsConnected: (state, action) => {
      return {
        ...state,
        connected: action.payload,
      };
    },
  },
});

export const {
  setIsInstalled,
  updateConnectedAccountData,
  setIsLocked,
  setController,
  setIsConnected,
} = walletConnection.actions;

export const walletConnectionSlice = (state) =>
  state.walletConnection.walletConnection;

export default walletConnection.reducer;
