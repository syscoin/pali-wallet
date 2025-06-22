import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { INetwork } from '@pollum-io/sysweb3-network';

import { IGlobalState, IChangingConnectedAccount } from '../vault/types';

const initialState: IGlobalState = {
  activeSlip44: null,
  advancedSettings: {
    refresh: false,
    ledger: false,
  },
  lastLogin: 0,
  hasEncryptedVault: false,
  hasEthProperty: true,
  error: null,
  isDappAskingToChangeNetwork: false,
  isSwitchingAccount: false,
  networkStatus: 'idle',
  networkTarget: undefined,
  changingConnectedAccount: {
    host: undefined,
    isChangingConnectedAccount: false,
    newConnectedAccount: undefined,
    connectedAccountType: undefined,
  },
  coinsList: [],
  // Transient loading states - always start as false
  loadingStates: {
    isLoadingBalances: false,
    isLoadingTxs: false,
    isLoadingAssets: false,
    isLoadingNfts: false,
  },
};

const vaultGlobalSlice = createSlice({
  name: 'vaultGlobal',
  initialState,
  reducers: {
    rehydrate(state: IGlobalState, action: PayloadAction<IGlobalState>) {
      // Complete replacement but ALWAYS reset loading states to false
      const restoredState = action.payload;
      return {
        ...restoredState,
        loadingStates: {
          isLoadingBalances: false,
          isLoadingTxs: false,
          isLoadingAssets: false,
          isLoadingNfts: false,
        },
      };
    },
    resetLoadingStates(state: IGlobalState) {
      state.loadingStates = {
        isLoadingBalances: false,
        isLoadingTxs: false,
        isLoadingAssets: false,
        isLoadingNfts: false,
      };
    },
    setIsLoadingBalances(state: IGlobalState, action: PayloadAction<boolean>) {
      state.loadingStates.isLoadingBalances = action.payload;
    },
    setIsLoadingTxs(state: IGlobalState, action: PayloadAction<boolean>) {
      state.loadingStates.isLoadingTxs = action.payload;
    },
    setIsLoadingAssets(state: IGlobalState, action: PayloadAction<boolean>) {
      state.loadingStates.isLoadingAssets = action.payload;
    },
    setIsLoadingNfts(state: IGlobalState, action: PayloadAction<boolean>) {
      state.loadingStates.isLoadingNfts = action.payload;
    },
    setActiveSlip44(state: IGlobalState, action: PayloadAction<number>) {
      state.activeSlip44 = action.payload;
    },
    setAdvancedSettings(
      state: IGlobalState,
      action: PayloadAction<{
        advancedProperty: string;
        isActive: boolean;
        isFirstTime?: boolean;
      }>
    ) {
      const { advancedProperty, isActive, isFirstTime } = action.payload;

      if (isFirstTime) {
        state.advancedSettings = {
          refresh: false,
          ledger: false,
        };
      }

      state.advancedSettings[advancedProperty] = isActive;
    },
    setError(state: IGlobalState, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    setNetworkStatus(
      state: IGlobalState,
      action: PayloadAction<'idle' | 'switching' | 'error'>
    ) {
      state.networkStatus = action.payload;
    },
    setIsDappAskingToChangeNetwork(
      state: IGlobalState,
      action: PayloadAction<boolean>
    ) {
      state.isDappAskingToChangeNetwork = action.payload;
    },
    setIsSwitchingAccount(state: IGlobalState, action: PayloadAction<boolean>) {
      state.isSwitchingAccount = action.payload;
    },
    setLastLogin(state: IGlobalState) {
      state.lastLogin = Date.now();
    },
    setHasEncryptedVault(state: IGlobalState, action: PayloadAction<boolean>) {
      state.hasEncryptedVault = action.payload;
    },
    setHasEthProperty(state: IGlobalState, action: PayloadAction<boolean>) {
      state.hasEthProperty = action.payload;
    },
    setCoinsList(state: IGlobalState, action: PayloadAction<Array<any>>) {
      state.coinsList = action.payload;
    },
    setChangingConnectedAccount(
      state: IGlobalState,
      action: PayloadAction<IChangingConnectedAccount>
    ) {
      state.changingConnectedAccount = action.payload;
    },
    startSwitchNetwork(state: IGlobalState, action: PayloadAction<INetwork>) {
      state.networkStatus = 'switching';
      state.networkTarget = action.payload;
    },
    switchNetworkSuccess(state: IGlobalState) {
      state.networkStatus = 'idle';
      state.networkTarget = undefined;
    },
    switchNetworkError(state: IGlobalState) {
      state.networkStatus = 'error';
    },
    resetNetworkStatus(state: IGlobalState) {
      state.networkStatus = 'idle';
      state.networkTarget = undefined;
    },
  },
});

export const {
  rehydrate,
  resetLoadingStates,
  setIsLoadingBalances,
  setIsLoadingTxs,
  setIsLoadingAssets,
  setIsLoadingNfts,
  setActiveSlip44,
  setAdvancedSettings,
  setError,
  setNetworkStatus,
  setIsDappAskingToChangeNetwork,
  setIsSwitchingAccount,
  setLastLogin,
  setHasEncryptedVault,
  setHasEthProperty,
  setCoinsList,
  setChangingConnectedAccount,
  startSwitchNetwork,
  switchNetworkSuccess,
  switchNetworkError,
  resetNetworkStatus,
} = vaultGlobalSlice.actions;

export default vaultGlobalSlice.reducer;
