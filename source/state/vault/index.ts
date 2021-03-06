import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  initialNetworksState,
  initialActiveAccountState,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-utils';

import trustedApps from './trustedApps.json';
import { IVaultState } from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {},
  activeAccount: {
    ...initialActiveAccountState,
    transactions: [],
    assets: [],
  },
  activeNetwork: {
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
    currency: 'sys',
  },
  isPendingBalances: false,
  timer: 5,
  networks: initialNetworksState,
  trustedApps,
  activeToken: 'SYS',
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
      const { id } = state.activeAccount;
      state.accounts[id].transactions.push(action.payload);
      state.activeAccount.transactions.push(action.payload);
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
        chainId?: number;
        network: INetwork;
      }>
    ) {
      const { chain, network, chainId } = action.payload;

      const replaceNetworkName = `${network.label
        .replace(/\s/g, '')
        .toLocaleLowerCase()}-${network.chainId}`;

      const alreadyExist = Boolean(state.networks[chain][Number(chainId)]);

      if (alreadyExist) {
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
      // eslint-disable-next-line
      return;
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
      state.activeAccount.transactions = [];
    },
    setActiveAccountProperty(
      state: IVaultState,
      action: PayloadAction<{
        property: string;
        value: number | string | boolean | any[];
      }>
    ) {
      const { property, value } = action.payload;

      if (!(property in state.activeAccount))
        throw new Error('Unable to set property. Unknown key');

      state.activeAccount[property] = value;

      const {
        activeAccount: { id },
      } = state;
      state.accounts[id][property] = value;
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

      if (!state.accounts[id])
        throw new Error('Unable to set label. Account not found');

      state.accounts[id].label = label;
    },
    setStoreError(state: IVaultState, action: PayloadAction<boolean>) {
      state.error = action.payload;
    },
  },
});

export const {
  setAccounts,
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
  setStoreError,
} = VaultState.actions;

export default VaultState.reducer;
