

import { createSlice } from "@reduxjs/toolkit";

export const userSlice = createSlice({
    name:"user",
    initialState: {
      walletConnection: {
        isInstalled: false,
        canConnect: false,
        connectedAccountData: {
          balance: 0,
          connectedAccount: null,
          connectedAccountAddress: ''
        },
        controller: null,
        connected: false,
      }
    },
   
    reducers: {
        setIsInstalled: (state, action) => {
          return {
            ...state,
            isInstalled: action.payload
          }
        },
        updateConnectedAccountData: (state, action) => {
          return {
            ...state,
            connectedAccountData: {
              balance: action.payload.balance,
              connectedAccount: action.payload.connectedAccount,
              connectedAccountAddress: action.payload.connectedAccountAddress
            }
          }
        },
        updateCanConnect: (state, action) => {
          return {
            ...state,
            canConnect: action.payload
          }
        },
        setController: (state, action) => {
          return {
            ...state,
            controller: action.payload
          }
        },
        setIsConnected: (state, action) => {
          return {
            ...state,
            connected: action.payload
          }
        }
    },
});

export const {
    setIsInstalled,
    updateConnectedAccountData,
    updateCanConnect,
    setController,
    setIsConnected
} = userSlice.actions;

export const selectUser = (state) => state.user.user;

export default userSlice.reducer;