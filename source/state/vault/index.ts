import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import {
  initialNetworksState,
  initialActiveHdAccountState,
  initialActiveImportedAccountState,
  KeyringAccountType,
  IWalletState,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';

import {
  IChangingConnectedAccount,
  IPaliAccount,
  IVaultState,
  PaliAccount,
} from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {
    [KeyringAccountType.HDAccount]: {
      [initialActiveHdAccountState.id]: {
        ...initialActiveHdAccountState,
        assets: { ethereum: [], syscoin: [] },
        transactions: [],
      },
    },
    [KeyringAccountType.Imported]: {},
    //TODO: add Trezor account type here
  },
  activeAccount: {
    id: 0,
    type: KeyringAccountType.HDAccount,
  },
  activeChain: INetworkType.Syscoin,
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
    connectedAccountType: undefined,
  },
  timer: 5,
  isTimerEnabled: true,
  networks: initialNetworksState,
  error: false,
};

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    setAccounts(
      state: IVaultState,
      action: PayloadAction<{
        [key in KeyringAccountType]: PaliAccount;
      }>
    ) {
      state.accounts = action.payload; //todo: account should be adjusted with the new type and format
    },
    setNetworkChange(
      state: IVaultState,
      action: PayloadAction<{
        activeChain: INetworkType;
        wallet: IWalletState;
      }>
    ) {
      const { activeChain, wallet } = action.payload;
      state.activeChain = activeChain;
      state.activeNetwork = wallet.activeNetwork;
      state.activeAccount = {
        id: wallet.activeAccountId,
        type: wallet.activeAccountType,
      };
      state.networks = wallet.networks;
      for (const accountType in wallet.accounts) {
        for (const accountId in wallet.accounts[accountType]) {
          const account = wallet.accounts[accountType][accountId];
          if (!account.xpub) {
            //This is for the default imported account, we don't want to add it yet to pali State
            continue;
          }
          const mainAccount: IPaliAccount =
            state.accounts[accountType][account.id];
          // Update the account properties, leaving the assets and transactions fields unchanged
          state.accounts[accountType][account.id] = {
            ...account,
            assets: mainAccount.assets,
            transactions: mainAccount.transactions,
          };
        }
      }
    },
    setAccountTransactions(state: IVaultState, action: PayloadAction<any>) {
      const { id, type } = state.activeAccount;
      state.accounts[type][id].transactions.unshift(action.payload);
    },
    createAccount(
      state: IVaultState,
      action: PayloadAction<{
        account: IPaliAccount;
        accountType: KeyringAccountType;
      }>
    ) {
      const { account, accountType } = action.payload;
      state.accounts[accountType][account.id] = account;
    },
    setNetworks(
      state: IVaultState,
      action: PayloadAction<{
        chain: string;
        isEdit: boolean;
        network: INetwork;
      }>
    ) {
      //TODO: refactor, it should just set the network the verification is already done on sysweb3
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
    setActiveAccount(
      state: IVaultState,
      action: PayloadAction<{
        id: number;
        type: KeyringAccountType;
      }>
    ) {
      // const { accountId, accountType } = action.payload;
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
    setNetworkType(state: IVaultState, action: PayloadAction<INetworkType>) {
      state.activeChain = action.payload;
    },
    setIsPendingBalances(state: IVaultState, action: PayloadAction<boolean>) {
      const { id, type } = state.activeAccount;
      state.isPendingBalances = action.payload;
      state.accounts[type][id].transactions = []; // TODO: check a better way to handle network transaction
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
        value:
          | number
          | string
          | boolean
          | any[]
          | { ethereum: any[]; syscoin: any[] };
      }>
    ) {
      const { id, type } = state.activeAccount;
      const { property, value } = action.payload;

      if (!(property in state.accounts[type][id]))
        throw new Error('Unable to set property. Unknown key');

      state.accounts[type][id][property] = value;
    },
    forgetWallet() {
      return initialState;
    },
    removeAccounts(state: IVaultState) {
      state.accounts = {
        [KeyringAccountType.HDAccount]: {
          [initialActiveHdAccountState.id]: {
            ...initialActiveHdAccountState,
            assets: { ethereum: [], syscoin: [] },
            transactions: [],
          },
        },
        [KeyringAccountType.Imported]: {
          [initialActiveImportedAccountState.id]: {
            ...initialActiveImportedAccountState,
            assets: { ethereum: [], syscoin: [] },
            transactions: [],
          },
        },
      };
      state.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
    },
    removeAccount(
      state: IVaultState,
      action: PayloadAction<{ id: number; type: KeyringAccountType }>
    ) {
      const { id, type } = action.payload;
      delete state.accounts[type][id];
    },
    setAccountLabel(
      state: IVaultState,
      action: PayloadAction<{
        id: number;
        label: string;
        type: KeyringAccountType;
      }>
    ) {
      const { label, id, type } = action.payload;

      if (!state.accounts[type][id])
        throw new Error('Unable to set label. Account not found');

      state.accounts[type][id].label = label;
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
        accountType: KeyringAccountType;
        newAccountsAssets: any;
      }>
    ) {
      const { newAccountsAssets, accountId, accountType } = action.payload;

      const { isBitcoinBased } = state;
      //TODO: remove this if condition and guarantee that this redux state is only called on the appropriate state transition.
      //TODO: the appropriate state transition is updating ERC tokens balance, so its a great concern that this if is here
      if (!isBitcoinBased) {
        state.accounts[accountType][accountId].assets.ethereum =
          newAccountsAssets;
      }
    },
    setUpdatedAllErcTokensBalance(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        updatedTokens: any[];
      }>
    ) {
      const { accountId, accountType, updatedTokens } = action.payload;
      const { isBitcoinBased, accounts, activeAccount, isNetworkChanging } =
        state;
      const { type, id } = activeAccount;
      const findAccount = accounts[accountType][accountId];

      if (
        !Boolean(
          findAccount.address === accounts[type][id].address ||
            isNetworkChanging ||
            isBitcoinBased
        )
      )
        return;

      state.accounts[type][accountId].assets.ethereum = updatedTokens;
    },
  },
});

export const {
  setAccounts,
  setActiveAccount,
  setActiveAccountProperty,
  setNetworkType,
  setNetworkChange,
  setActiveNetwork,
  setIsNetworkChanging,
  setIsPendingBalances,
  setIsLoadingTxs,
  setChangingConnectedAccount,
  setLastLogin,
  setNetworks,
  setTimer,
  setIsTimerEnabled,
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
  setUpdatedAllErcTokensBalance,
} = VaultState.actions;

export default VaultState.reducer;
