import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  IKeyringAccountState,
  INetwork,
  INetworkType,
  initialActiveAccountState,
  initialNetworksState,
} from '@pollum-io/sysweb3-utils';

import trustedApps from './trustedApps.json';
import { IVaultState } from './types';

export const initialState: IVaultState = {
  lastLogin: 0, //
  accounts: {},
  activeAccount: initialActiveAccountState, //
  activeNetwork: {
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
  },
  isPendingBalances: false, //
  timer: 5, //
  networks: initialNetworksState,
  trustedApps, //
  activeToken: 'SYS',
  temporaryTransactionState: { executing: false, type: '' }, // todo: remove temporary tx state from sysweb3
  hasEncryptedVault: false, //
  encryptedMnemonic: '', //
  getState: () => initialState, //
  version: '2.0.0', // todo: remove version from sysweb3
};

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    setNetworks(
      state: IVaultState,
      action: PayloadAction<{ prefix: string; value: INetwork }>
    ) {
      const { prefix, value } = action.payload;

      state.networks = {
        ...state.networks,
        [prefix]: value,
      };
    },
    removeNetwork(
      state: IVaultState,
      action: PayloadAction<{ prefix: string; chainId: number }>
    ) {
      const { prefix, chainId } = action.payload;

      delete state.networks[prefix][chainId];
    },
    // todo: remove this
    clearAllTransactions(state: IVaultState) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: false,
          type: '',
        },
      };
    },
    setTemporaryTransactionState(
      state: IVaultState,
      action: PayloadAction<{ executing: boolean; type: string }>
    ) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: action.payload.executing,
          type: action.payload.type,
        },
      };
    },
    setTimer(state: IVaultState, action: PayloadAction<number>) {
      state.timer = action.payload;
    },
    setLastLogin(state: IVaultState) {
      state.lastLogin = Date.now();
    },
    setActiveAccount(
      state: IVaultState,
      action: PayloadAction<IKeyringAccountState>
    ) {
      state.activeAccount = action.payload;
    },
    setActiveNetwork(state: IVaultState, action: PayloadAction<INetwork>) {
      state.activeNetwork = action.payload;
    },
    setIsPendingBalances(state: IVaultState, action: PayloadAction<boolean>) {
      state.isPendingBalances = action.payload;
      state.activeAccount.balances = {
        [INetworkType.Ethereum]: 0,
        [INetworkType.Syscoin]: 0,
      };
      state.activeToken = '';
    },
    setActiveAccountProperty(
      state: IVaultState,
      action: PayloadAction<{
        property: string;
        value: number | string | boolean;
      }>
    ) {
      const { property, value } = action.payload;

      state.activeAccount = {
        ...state.activeAccount,
        [property]: value,
      };
    },
    setActiveToken(state: IVaultState, action: PayloadAction<string>) {
      state.activeToken = action.payload;
    },
    setEncryptedMnemonic(state: IVaultState, action: PayloadAction<string>) {
      state.encryptedMnemonic = action.payload;
    },
    forgetWallet() {
      return initialState;
    },
    removeAccounts(state: IVaultState) {
      state.accounts = {};
      state.activeAccount = initialActiveAccountState;
    },
    removeAccount(state: IVaultState, action: PayloadAction<{ id: number }>) {
      delete state.accounts[action.payload.id];
    },
  },
});

export const {
  setActiveAccount,
  setActiveAccountProperty,
  setActiveNetwork,
  setActiveToken,
  setIsPendingBalances,
  setLastLogin,
  setNetworks,
  setTimer,
  setEncryptedMnemonic,
  setTemporaryTransactionState,
  clearAllTransactions,
  forgetWallet,
  removeAccount,
  removeAccounts,
  removeNetwork,
} = VaultState.actions;

export default VaultState.reducer;
