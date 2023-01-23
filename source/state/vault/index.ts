import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ethers } from 'ethers';
import loadsh from 'lodash';

import {
  initialNetworksState,
  initialActiveAccountState,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import { getErc20Abi, getErc21Abi, INetwork } from '@pollum-io/sysweb3-utils';

import { ITokenEthProps } from 'types/tokens';

import { IChangingConnectedAccount, IVaultState } from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {},
  activeAccount: {
    ...initialActiveAccountState,
    transactions: [],
    assets: { syscoin: [], ethereum: [] },
  },
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
  changingConnectedAccount: {
    host: undefined,
    isChangingConnectedAccount: false,
    newConnectedAccount: undefined,
  },
  timer: 5,
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
      const { id } = state.activeAccount;
      state.accounts[id].transactions.unshift(action.payload);
      state.activeAccount.transactions.unshift(action.payload);
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
      // inject.ethereum.chainId = action.payload.chainId.toString();
      // inject.ethereum.networkVersion = parseInt(
      //   action.payload.chainId.toString(),
      //   16
      // ).toString();
    },
    setIsPendingBalances(state: IVaultState, action: PayloadAction<boolean>) {
      state.isPendingBalances = action.payload;
      state.activeAccount.transactions = []; // TODO: check a better way to handle network transaction
    },
    setIsLoadingTxs(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingTxs = action.payload;
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
      const { property, value } = action.payload;

      if (!(property in state.activeAccount))
        throw new Error('Unable to set property. Unknown key');

      state.activeAccount[property] = value;

      const {
        activeAccount: { id },
      } = state;
      state.accounts[id][property] = value;
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
    setIsBitcoinBased(state: IVaultState, action: PayloadAction<boolean>) {
      state.isBitcoinBased = action.payload;
    },
    setUpdatedTokenBalace(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        newAccountsAssets: any;
        newActiveAccountAssets: any;
      }>
    ) {
      const { newAccountsAssets, newActiveAccountAssets, accountId } =
        action.payload;

      state.accounts[accountId].assets.ethereum = newAccountsAssets;
      state.activeAccount.assets.ethereum = newActiveAccountAssets;
    },
    setUpdatedNativeTokenBalance(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        balance: number;
      }>
    ) {
      const { accountId, balance } = action.payload;
      const { isBitcoinBased } = state;

      if (isBitcoinBased) {
        state.accounts[accountId].balances.syscoin = balance;
        state.activeAccount.balances.syscoin = balance;

        return;
      }

      state.accounts[accountId].balances.ethereum = balance;
      state.activeAccount.balances.ethereum = balance;
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
  setChangingConnectedAccount,
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
  setIsBitcoinBased,
  setUpdatedTokenBalace,
  setUpdatedNativeTokenBalance,
} = VaultState.actions;

export default VaultState.reducer;
