import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import { IGlobalState, IChangingConnectedAccount } from '../vault/types';
import { PALI_NETWORKS_STATE } from 'utils/constants';

const initialState: IGlobalState = {
  activeSlip44: null,
  advancedSettings: {
    refresh: false,
    ledger: false,
    autolock: 5, // default 5 minutes timer
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
  // Transient loading states - always start as false
  loadingStates: {
    isLoadingBalances: false,
    isLoadingTxs: false,
    isLoadingAssets: false,
    isLoadingNfts: false,
  },
  networks: PALI_NETWORKS_STATE,
  isPollingUpdate: false,
  networkQuality: undefined,
};

const vaultGlobalSlice = createSlice({
  name: 'vaultGlobal',
  initialState,
  reducers: {
    rehydrate(state: IGlobalState, action: PayloadAction<IGlobalState>) {
      // Use stored state as-is, but ensure networks always exists
      return {
        ...action.payload,
        // Ensure networks always exists, use default if not in restored state
        networks: action.payload.networks || PALI_NETWORKS_STATE,
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
        isFirstTime?: boolean;
        value: boolean | number;
      }>
    ) {
      const { advancedProperty, value, isFirstTime } = action.payload;

      if (isFirstTime) {
        state.advancedSettings = {
          refresh: false,
          ledger: false,
          autolock: 5, // default 5 minutes timer
        };
      }

      state.advancedSettings[advancedProperty] = value;
    },
    setError(state: IGlobalState, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
    setNetworkStatus(
      state: IGlobalState,
      action: PayloadAction<'idle' | 'switching' | 'error' | 'connecting'>
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
    startConnecting(state: IGlobalState) {
      state.networkStatus = 'connecting';
      state.networkTarget = undefined;
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
    setNetwork(
      state: IGlobalState,
      action: PayloadAction<{
        isEdit?: boolean;
        network: INetwork;
      }>
    ) {
      const { network, isEdit } = action.payload;

      // Ensure networks exists
      if (!state.networks) {
        state.networks = PALI_NETWORKS_STATE;
      }

      if (isEdit) {
        // Find and update existing network, preserving metadata
        const chainType = network.kind;
        const networks =
          chainType === INetworkType.Ethereum
            ? state.networks.ethereum
            : state.networks.syscoin;

        if (networks && networks[network.chainId]) {
          const existingNetwork = networks[network.chainId];

          // Merge new network data with existing metadata
          networks[network.chainId] = {
            ...network,
            // Preserve CoinGecko IDs and other metadata if they exist
            ...(existingNetwork.coingeckoId && {
              coingeckoId: existingNetwork.coingeckoId,
            }),
            ...(existingNetwork.coingeckoPlatformId && {
              coingeckoPlatformId: existingNetwork.coingeckoPlatformId,
            }),
          };
        }
      } else {
        // Add new network
        if (network.kind === INetworkType.Ethereum) {
          if (!state.networks.ethereum) {
            state.networks.ethereum = {};
          }
          state.networks.ethereum[network.chainId] = network;
        } else {
          if (!state.networks.syscoin) {
            state.networks.syscoin = {};
          }
          state.networks.syscoin[network.chainId] = network;
        }
      }
    },
    setNetworks(
      state: IGlobalState,
      action: PayloadAction<{
        ethereum: { [chainId: number]: INetwork };
        syscoin: { [chainId: number]: INetwork };
      }>
    ) {
      // Set all networks at once
      state.networks = action.payload;
    },
    removeNetwork(
      state: IGlobalState,
      action: PayloadAction<{
        chain: INetworkType;
        chainId: number;
        key?: string;
        label: string;
        rpcUrl: string;
      }>
    ) {
      const { chain, chainId } = action.payload;

      // Ensure networks exists
      if (!state.networks) {
        return;
      }

      if (chain === INetworkType.Ethereum && state.networks.ethereum) {
        delete state.networks.ethereum[chainId];
      } else if (chain === INetworkType.Syscoin && state.networks.syscoin) {
        delete state.networks.syscoin[chainId];
      }
    },
    setIsPollingUpdate(state: IGlobalState, action: PayloadAction<boolean>) {
      state.isPollingUpdate = action.payload;
    },
    updateNetworkQualityLatency(
      state: IGlobalState,
      action: PayloadAction<{
        criticalThreshold?: number;
        latency: number;
        minAcceptableLatency?: number;
      }>
    ) {
      const {
        latency,
        minAcceptableLatency = 500,
        criticalThreshold = 10000,
      } = action.payload;

      if (!state.networkQuality) {
        state.networkQuality = {};
      }

      // Update network quality state
      // This persists until the next operation naturally updates it
      // The UI will show:
      // - Orange indicator if hasSlowOperations is true
      // - Red indicator if hasCriticalErrors is true (timeouts/failures)
      state.networkQuality.lastBalanceLatency = latency;
      state.networkQuality.hasSlowOperations = latency > minAcceptableLatency;
      state.networkQuality.hasCriticalErrors = latency >= criticalThreshold;
      state.networkQuality.timestamp = Date.now();
    },
    clearNetworkQualityIfStale(state: IGlobalState) {
      // Only clear network quality if it's older than 5 minutes
      // This prevents clearing fresh quality data during network switches
      if (state.networkQuality && state.networkQuality.timestamp) {
        const ageInMs = Date.now() - state.networkQuality.timestamp;
        const fiveMinutesInMs = 5 * 60 * 1000;

        if (ageInMs > fiveMinutesInMs) {
          state.networkQuality = undefined;
        }
      }
    },
    resetNetworkQualityForNewNetwork(state: IGlobalState) {
      // When switching to a new network, we want to reset quality tracking
      // but preserve it if we're on the same network
      // This is called when actually changing networks, not just reconnecting
      state.networkQuality = undefined;
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
  setChangingConnectedAccount,
  startSwitchNetwork,
  startConnecting,
  switchNetworkSuccess,
  switchNetworkError,
  resetNetworkStatus,
  setNetwork,
  setNetworks,
  removeNetwork,
  setIsPollingUpdate,
  updateNetworkQualityLatency,
  clearNetworkQualityIfStale,
  resetNetworkQualityForNewNetwork,
} = vaultGlobalSlice.actions;

export default vaultGlobalSlice.reducer;
