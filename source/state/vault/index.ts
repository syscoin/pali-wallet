import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  initialNetworksState,
  initialActiveAccountState,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-utils';

import { IChangingConnectedAccount, IVaultState } from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {
    0: {
      ...initialActiveAccountState,
      assets: { syscoin: [], ethereum: [] },
    },
  },
  activeAccount: 0,
  activeNetwork: {
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
    currency: 'sys',
  },
  isBitcoinBased: true,
  isPendingBalances: false,
  isNetworkChanging: false,
  isLoadingTxs: false,
  isLoadingAssets: false,
  changingConnectedAccount: {
    host: undefined,
    isChangingConnectedAccount: false,
    newConnectedAccount: undefined,
  },
  timer: 5,
  isTimerEnabled: true,
  networks: initialNetworksState,
  encryptedMnemonic: '',
  error: false,
};

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    setAccounts(
      state: IVaultState,
      action: PayloadAction<{
        [id: number]: IKeyringAccountState;
      }>
    ) {
      state.accounts = action.payload;
    },
    setAccountTransactions(state: IVaultState, action: PayloadAction<any>) {
      const id = state.activeAccount;
      state.accounts[id].transactions.unshift(action.payload);
    },
    createAccount(
      state: IVaultState,
      action: PayloadAction<IKeyringAccountState>
    ) {
      state.accounts[action.payload.id] = action.payload;
    },
    setNetworks(
      state: IVaultState,
      action: PayloadAction<{
        chain: string;
        isEdit: boolean;
        network: INetwork;
      }>
    ) {
      const { chain, network, isEdit } = action.payload;

      const replaceNetworkName = `${network.label
        .replace(/\s/g, '')
        .toLocaleLowerCase()}-${network.chainId}`;

      const alreadyExist = Boolean(
        state.networks[chain][Number(network.chainId)]
      );

      if (alreadyExist && !isEdit) {
        const verifyIfRpcOrNameExists = Object.values(
          state.networks[chain]
        ).find(
          (networkState: INetwork) =>
            networkState.url === network.url ||
            networkState.key === replaceNetworkName
        );

        if (verifyIfRpcOrNameExists)
          throw new Error(
            'Network RPC or name already exists, try with a new one!'
          );

        state.networks[chain] = {
          ...state.networks[chain],
          [replaceNetworkName]: {
            ...network,

            key: replaceNetworkName,
          },
        };

        return;
      }
      state.networks[chain] = {
        ...state.networks[chain],
        [network.chainId]: network,
      };

      return;
    },
    removeNetwork(
      state: IVaultState,
      action: PayloadAction<{ chainId: number; key?: string; prefix: string }>
    ) {
      const { prefix, chainId, key } = action.payload;

      if (key) {
        delete state.networks[prefix][key];
        return;
      }

      delete state.networks[prefix][chainId];
    },
    setTimer(state: IVaultState, action: PayloadAction<number>) {
      state.timer = action.payload;
    },
    setIsTimerEnabled(state: IVaultState, action: PayloadAction<boolean>) {
      state.isTimerEnabled = action.payload;
    },
    setLastLogin(state: IVaultState) {
      state.lastLogin = Date.now();
    },
    setActiveAccount(state: IVaultState, action: PayloadAction<number>) {
      state.activeAccount = action.payload;
    },
    setActiveNetwork(state: IVaultState, action: PayloadAction<INetwork>) {
      state.activeNetwork = action.payload;
      // inject.ethereum.chainId = action.payload.chainId.toString();
      // inject.ethereum.networkVersion = parseInt(
      //   action.payload.chainId.toString(),
      //   16
      // ).toString();
    },
    setIsPendingBalances(state: IVaultState, action: PayloadAction<boolean>) {
      const id = state.activeAccount;
      state.isPendingBalances = action.payload;
      state.accounts[id].transactions = []; // TODO: check a better way to handle network transaction
    },
    setIsLoadingTxs(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingTxs = action.payload;
    },
    setIsLoadingAssets(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingAssets = action.payload;
    },
    setIsNetworkChanging(state: IVaultState, action: PayloadAction<boolean>) {
      state.isNetworkChanging = action.payload;
    },
    setChangingConnectedAccount(
      state: IVaultState,
      action: PayloadAction<IChangingConnectedAccount>
    ) {
      state.changingConnectedAccount = action.payload;
    },
    setActiveAccountProperty(
      state: IVaultState,
      action: PayloadAction<{
        property: string;
        value: number | string | boolean | any[];
      }>
    ) {
      //Later with new sysweb3 change this to only get activeAccount
      const { activeAccount: id } = state;
      const { property, value } = action.payload;

      if (!(property in state.accounts[id]))
        throw new Error('Unable to set property. Unknown key');

      state.accounts[id][property] = value;
    },
    setEncryptedMnemonic(state: IVaultState, action: PayloadAction<string>) {
      state.encryptedMnemonic = action.payload;
    },
    forgetWallet() {
      return initialState;
    },
    removeAccounts(state: IVaultState) {
      state.accounts = {
        0: {
          ...initialActiveAccountState,
          assets: { syscoin: [], ethereum: [] },
        },
      };
      state.activeAccount = 0;
    },
    removeAccount(state: IVaultState, action: PayloadAction<{ id: number }>) {
      delete state.accounts[action.payload.id];
    },
    setAccountLabel(
      state: IVaultState,
      action: PayloadAction<{ id: number; label: string }>
    ) {
      const { label, id } = action.payload;

      if (!state.accounts[id])
        throw new Error('Unable to set label. Account not found');

      state.accounts[id].label = label;
    },
    setStoreError(state: IVaultState, action: PayloadAction<boolean>) {
      state.error = action.payload;
    },
    setIsBitcoinBased(state: IVaultState, action: PayloadAction<boolean>) {
      state.isBitcoinBased = action.payload;
    },

    setUpdatedAllErcTokensBalance(
      state: IVaultState,
      action: PayloadAction<{
        updatedTokens: any[];
      }>
    ) {
      const { updatedTokens } = action.payload;
      const { isBitcoinBased, activeAccount, isNetworkChanging } = state;

      if (!Boolean(isNetworkChanging || isBitcoinBased)) return;

      state.accounts[activeAccount].assets.ethereum = updatedTokens;
    },
  },
});

export const {
  setAccounts,
  setActiveAccount,
  setActiveAccountProperty,
  setActiveNetwork,
  setIsNetworkChanging,
  setIsPendingBalances,
  setIsLoadingTxs,
  setIsLoadingAssets,
  setChangingConnectedAccount,
  setLastLogin,
  setNetworks,
  setTimer,
  setIsTimerEnabled,
  setEncryptedMnemonic,
  forgetWallet,
  removeAccount,
  removeAccounts,
  removeNetwork,
  createAccount,
  setAccountLabel,
  setAccountTransactions,
  setStoreError,
  setIsBitcoinBased,
  setUpdatedAllErcTokensBalance,
} = VaultState.actions;

export default VaultState.reducer;
