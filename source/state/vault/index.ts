import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  INetwork,
  initialNetworksState,
  IKeyringAccountState,
  initialActiveAccountState,
} from '@pollum-io/sysweb3-utils';

import trustedApps from './trustedApps.json';
import { IVaultState } from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {},
  activeAccount: initialActiveAccountState,
  activeNetwork: {
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
    isTestnet: false,
    currency: 'SYS',
  },
  isPendingBalances: false,
  timer: 5,
  networks: initialNetworksState,
  trustedApps,
  activeToken: 'SYS',
  encryptedMnemonic: '',
};

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    // todo: set account tx and add to ikeyringaccountstate
    setAccountTransactions(
      state: IVaultState,
      action: PayloadAction<{ tx: any; txid: string }>
    ) {
      const { txid, tx } = action.payload;

      state.accounts[state.activeAccount.id] = {
        ...state.accounts[state.activeAccount.id],
        [txid]: tx,
      };
    },
    createAccount(
      state: IVaultState,
      action: PayloadAction<IKeyringAccountState>
    ) {
      state.accounts = {
        ...state.accounts,
        [action.payload.id]: action.payload,
      };
    },
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
      action: PayloadAction<{ chainId: number; prefix: string }>
    ) {
      const { prefix, chainId } = action.payload;

      delete state.networks[prefix][chainId];
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
    setAccountLabel(
      state: IVaultState,
      action: PayloadAction<{ id: number; label: string }>
    ) {
      const { label, id } = action.payload;

      state.accounts[id] = {
        ...state.accounts[id],
        label,
      };
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
  forgetWallet,
  removeAccount,
  removeAccounts,
  removeNetwork,
  createAccount,
  setAccountLabel,
  setAccountTransactions,
} = VaultState.actions;

export default VaultState.reducer;
