import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ethers } from 'ethers';
import cloneDeep from 'lodash/cloneDeep';
import take from 'lodash/take';

import {
  initialNetworksState,
  initialActiveHdAccountState,
  initialActiveImportedAccountState,
  KeyringAccountType,
  IWalletState,
  IKeyringBalances,
  initialActiveTrezorAccountState,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import {
  IEvmTransaction,
  IEvmTransactionResponse,
  ISysTransaction,
  TransactionValueType,
} from 'scripts/Background/controllers/transactions/types';
import { convertTransactionValueToCompare } from 'scripts/Background/controllers/transactions/utils';
import { ITokenEthProps } from 'types/tokens';
import { isERC1155Transfer } from 'utils/transactions';

import {
  IChangingConnectedAccount,
  IPaliAccount,
  IVaultState,
  PaliAccount,
  TransactionsType,
} from './types';

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: {
    [KeyringAccountType.HDAccount]: {
      [initialActiveHdAccountState.id]: {
        ...initialActiveHdAccountState,
        assets: { ethereum: [], syscoin: [], nfts: [] },
        transactions: { ethereum: {}, syscoin: {} },
      },
    },
    [KeyringAccountType.Imported]: {},
    [KeyringAccountType.Trezor]: {},
    [KeyringAccountType.Ledger]: {},
    //TODO: add Trezor account type here
  },
  activeAccount: {
    id: 0,
    type: KeyringAccountType.HDAccount,
  },
  advancedSettings: {
    refresh: false,
    ledger: false,
  },
  hasEthProperty: true,
  activeChain: INetworkType.Syscoin,
  activeNetwork: {
    chainId: 57,
    url: 'https://blockbook.elint.services/',
    label: 'Syscoin Mainnet',
    default: true,
    currency: 'sys',
    slip44: 57,
    isTestnet: false,
  },
  hasErrorOndAppEVM: false,
  isBitcoinBased: true,
  isLoadingBalances: false,
  isNetworkChanging: false,
  isLoadingTxs: false,
  isLoadingAssets: false,
  isLoadingNfts: false,
  changingConnectedAccount: {
    host: undefined,
    isChangingConnectedAccount: false,
    newConnectedAccount: undefined,
    connectedAccountType: undefined,
  },
  timer: 30,
  isTimerEnabled: true,
  networks: initialNetworksState,
  error: false,
  isPolling: false,
  currentBlock: undefined,
  coinsList: [],
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
    setAccountsWithLabelEdited(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        label: string;
      }>
    ) {
      const { label, accountId, accountType } = action.payload;

      state.accounts[accountType][accountId].label = label;
    },
    setEditedEvmToken(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        editedToken: ITokenEthProps;
        tokenIndex: number;
      }>
    ) {
      const { editedToken, tokenIndex, accountId, accountType } =
        action.payload;

      state.accounts[accountType][accountId].assets.ethereum[tokenIndex] =
        editedToken;
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
    setAccountBalances(
      state: IVaultState,
      action: PayloadAction<IKeyringBalances>
    ) {
      state.accounts[state.activeAccount.type][
        state.activeAccount.id
      ].balances = action.payload;
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
        isFirstTime?: boolean;
        network: INetwork;
      }>
    ) {
      //TODO: refactor, it should just set the network the verification is already done on sysweb3
      const { chain, network, isEdit, isFirstTime } = action.payload;

      const replaceNetworkName = `${network.label
        .replace(/\s/g, '')
        .toLocaleLowerCase()}-${network.chainId}`;

      const networkKeyIdentifier = network.key ? network.key : network.chainId;

      const alreadyExist = Boolean(state.networks[chain][networkKeyIdentifier]);

      if (alreadyExist && !isEdit && !isFirstTime) {
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
        [networkKeyIdentifier]: network,
      };

      if (
        chain === state.activeChain &&
        state.networks[chain][networkKeyIdentifier].chainId ===
          state.activeNetwork.chainId &&
        state.networks[chain][networkKeyIdentifier].url ===
          state.activeNetwork.url
      ) {
        state.activeNetwork = network;
      }

      return;
    },
    removeNetwork(
      state: IVaultState,
      action: PayloadAction<{
        chain: INetworkType;
        chainId: number;
        key?: string;
        label: string;
        rpcUrl: string;
      }>
    ) {
      const { chain, chainId, rpcUrl, label, key } = action.payload;

      const cloneNetworkState = cloneDeep(state.networks);

      const updatedNetworks = Object.entries(cloneNetworkState[chain]).reduce(
        (result, [index, networkValue]) => {
          const networkTyped = networkValue as INetwork;

          if (key && networkTyped.key === key) {
            return result; // Skip the network with the provided key
          }

          if (
            networkTyped.url === rpcUrl &&
            networkTyped.chainId === chainId &&
            networkTyped.label === label
          ) {
            return result; // Skip the network that matches the criteria
          }

          return { ...result, [index]: networkValue }; // Keep the network in the updated object
        },
        {}
      );

      state.networks[chain] = updatedNetworks;
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
      state.activeAccount = action.payload;

      //reset current block number on changing accounts
      state.currentBlock = undefined;
    },
    setActiveNetwork(state: IVaultState, action: PayloadAction<INetwork>) {
      state.activeNetwork = action.payload;
    },
    setNetworkType(state: IVaultState, action: PayloadAction<INetworkType>) {
      state.activeChain = action.payload;
    },
    setIsLoadingBalances(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingBalances = action.payload;
    },
    setIsLoadingTxs(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingTxs = action.payload;
    },
    setIsLoadingAssets(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingAssets = action.payload;
    },
    setIsLoadingNfts(state: IVaultState, action: PayloadAction<boolean>) {
      state.isLoadingNfts = action.payload;
    },
    setIsNetworkChanging(state: IVaultState, action: PayloadAction<boolean>) {
      state.isNetworkChanging = action.payload;
    },
    setOpenDAppErrorModal(state: IVaultState, action: PayloadAction<boolean>) {
      state.hasErrorOndAppEVM = action.payload;
    },
    setHasEthProperty(state: IVaultState, action: PayloadAction<boolean>) {
      state.hasEthProperty = action.payload;
    },
    setCoinsList(state: IVaultState, action: PayloadAction<Array<any>>) {
      state.coinsList = action.payload;
    },
    setAdvancedSettings(
      state: IVaultState,
      action: PayloadAction<{
        advancedProperty: string;
        isActive: boolean;
        isFirstTime?: boolean;
      }>
    ) {
      const { advancedProperty, isActive, isFirstTime } = action.payload;
      if (
        state.advancedSettings?.[advancedProperty] !== undefined ||
        isFirstTime
      ) {
        state.advancedSettings = {
          ...state.advancedSettings,
          [advancedProperty]: isActive,
        };
      }

      if (state.advancedSettings?.[advancedProperty] === undefined) {
        state.advancedSettings = {
          ...state.advancedSettings,
          [advancedProperty]: isActive,
        };
      }
    },

    setAccountTypeInAccountsObject(
      state: IVaultState,
      action: PayloadAction<string>
    ) {
      const accountType = action.payload;

      if (state.accounts?.[accountType] === undefined) {
        state.accounts = {
          ...state.accounts,
          [accountType]: {},
        };
      }
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
    setAccountPropertyByIdAndType(
      state: IVaultState,
      action: PayloadAction<{
        id: number;
        property: string;
        type: KeyringAccountType;
        value: any;
      }>
    ) {
      const { id, type, property, value } = action.payload;

      if (!state.accounts[type][id]) throw new Error('Account not found');

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
            assets: { ethereum: [], syscoin: [], nfts: [] },
            transactions: { ethereum: {}, syscoin: {} },
          },
        },
        [KeyringAccountType.Imported]: {
          [initialActiveImportedAccountState.id]: {
            ...initialActiveImportedAccountState,
            assets: { ethereum: [], syscoin: [], nfts: [] },
            transactions: { ethereum: {}, syscoin: {} },
          },
        },
        [KeyringAccountType.Trezor]: {
          [initialActiveTrezorAccountState.id]: {
            ...initialActiveTrezorAccountState,
            assets: { ethereum: [], syscoin: [], nfts: [] },
            transactions: { ethereum: {}, syscoin: {} },
          },
        },
        [KeyringAccountType.Ledger]: {
          [initialActiveTrezorAccountState.id]: {
            ...initialActiveTrezorAccountState,
            assets: { ethereum: [], syscoin: [], nfts: [] },
            transactions: { ethereum: {}, syscoin: {} },
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
    setUpdatedAllErcTokensBalance(
      state: IVaultState,
      action: PayloadAction<{
        updatedTokens: any[];
      }>
    ) {
      const { updatedTokens } = action.payload;
      const { isBitcoinBased, accounts, activeAccount, isNetworkChanging } =
        state;
      const { type, id } = activeAccount;
      const findAccount = accounts[type][id];

      if (
        !Boolean(
          findAccount.address === accounts[type][id].address ||
            isNetworkChanging ||
            isBitcoinBased
        )
      )
        return;

      state.accounts[type][id].assets.ethereum = updatedTokens;
    },
    setIsPolling(state: IVaultState, action: PayloadAction<boolean>) {
      state.isPolling = action.payload;
    },
    setCurrentBlock(
      state: IVaultState,
      action: PayloadAction<ethers.providers.Block>
    ) {
      state.currentBlock = action.payload;
    },

    setUpdatedNftsToState: (
      state: IVaultState,
      action: PayloadAction<{
        id: number;
        type: KeyringAccountType;
        updatedNfts: INftsStructure[];
      }>
    ) => {
      const { updatedNfts, id, type } = action.payload;

      state.accounts[type][id].assets.nfts = updatedNfts;
    },

    setSingleTransactionToState: (
      state: IVaultState,
      action: PayloadAction<{
        chainId: number;
        networkType: TransactionsType;
        transaction: IEvmTransaction | ISysTransaction;
      }>
    ) => {
      const { activeAccount } = state;
      const { networkType, chainId, transaction } = action.payload;
      const currentAccount =
        state.accounts[activeAccount.type][activeAccount.id];

      // Check if the networkType exists in the current account's transactions
      if (!currentAccount.transactions[networkType]) {
        currentAccount.transactions[networkType] = {
          [chainId]: [
            transaction,
          ] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[],
        };
      } else {
        // Check if the chainId exists in the current networkType's transactions
        if (!currentAccount.transactions[networkType][chainId]) {
          currentAccount.transactions[networkType][chainId] = [
            transaction,
          ] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[];
        } else {
          // If the chainId exists, add the new transaction to the existing chainId array
          const currentUserTransactions = currentAccount.transactions[
            networkType
          ][chainId] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[];

          // Check if the array length is 30
          if (currentUserTransactions.length === 30) {
            // Create a new array by adding the new transaction at the beginning and limiting to 30 items
            const updatedTransactions = take(
              [transaction, ...currentUserTransactions],
              30
            );

            currentAccount.transactions[networkType][chainId] =
              updatedTransactions as IEvmTransaction[] & ISysTransaction[];
          } else {
            // If the array length is less than 30, simply push the new transaction
            currentUserTransactions.push(
              transaction as typeof networkType extends TransactionsType.Ethereum
                ? IEvmTransaction
                : ISysTransaction
            );
          }
        }
      }
    },

    setMultipleTransactionToState(
      state: IVaultState,
      action: PayloadAction<{
        chainId: number;
        networkType: TransactionsType;
        transactions: Array<IEvmTransaction | ISysTransaction>;
      }>
    ) {
      const { activeAccount, isBitcoinBased } = state;
      const { networkType, chainId, transactions } = action.payload;
      const currentAccount =
        state.accounts[activeAccount.type][activeAccount.id];

      const uniqueTxs: {
        [key: string]: IEvmTransactionResponse | ISysTransaction;
      } = {};

      const clonedUserTxs =
        cloneDeep(currentAccount.transactions[networkType][chainId]) || [];

      const transactionsToVerify = [...transactions, ...clonedUserTxs];

      transactionsToVerify.forEach(
        (tx: IEvmTransactionResponse | ISysTransaction) => {
          const hash = 'hash' in tx ? tx.hash : tx.txid;
          if (
            !uniqueTxs[hash] ||
            uniqueTxs[hash].confirmations < tx.confirmations
          ) {
            uniqueTxs[hash] = tx;
          }
        }
      );

      const treatedTxs = Object.values(uniqueTxs);

      // Check if the networkType exists in the current account's transactions
      if (!currentAccount.transactions[networkType]) {
        let chainTransactions = treatedTxs;
        // Cast the array to the correct type based on the networkType and value bigger than 0
        if (!isBitcoinBased) {
          chainTransactions = treatedTxs.filter((tx) => {
            if (
              convertTransactionValueToCompare(
                tx.value as TransactionValueType
              ) === 0 &&
              !isERC1155Transfer(tx as IEvmTransactionResponse)
            ) {
              return false;
            }
            return networkType === TransactionsType.Ethereum
              ? (tx as IEvmTransaction)
              : (tx as ISysTransaction);
          });
        }

        currentAccount.transactions[networkType] = {
          [chainId]:
            chainTransactions as (typeof networkType extends TransactionsType.Ethereum
              ? IEvmTransaction
              : ISysTransaction)[],
        };
      } else {
        // Check if the chainId exists in the current networkType's transactions
        if (!currentAccount.transactions[networkType][chainId]) {
          let chainTransactions = treatedTxs;
          // Create a new array with the correct type based on the networkType and value bigger than 0
          if (!isBitcoinBased) {
            chainTransactions = treatedTxs.filter((tx) => {
              if (
                convertTransactionValueToCompare(
                  tx.value as TransactionValueType
                ) === 0 &&
                !isERC1155Transfer(tx as IEvmTransactionResponse)
              ) {
                return false;
              }
              return networkType === TransactionsType.Ethereum
                ? (tx as IEvmTransaction)
                : (tx as ISysTransaction);
            });
          }

          currentAccount.transactions[networkType][chainId] =
            chainTransactions as (typeof networkType extends TransactionsType.Ethereum
              ? IEvmTransaction
              : ISysTransaction)[];
        } else {
          let castedTransactions = treatedTxs;
          // Filter and push the transactions based on the networkType and value bigger than 0
          if (!isBitcoinBased) {
            castedTransactions = treatedTxs.filter((tx) => {
              if (
                convertTransactionValueToCompare(
                  tx.value as TransactionValueType
                ) === 0 &&
                !isERC1155Transfer(tx as IEvmTransactionResponse)
              ) {
                return false;
              }
              return networkType === TransactionsType.Ethereum
                ? (tx as IEvmTransaction)
                : (tx as ISysTransaction);
            });
          }

          currentAccount.transactions[networkType][chainId] =
            //Using take method from lodash to set TXs limit at each state to 30 and only remove the last values and keep the newests
            take(
              castedTransactions,
              30
            ) as (typeof networkType extends TransactionsType.Ethereum
              ? IEvmTransaction
              : ISysTransaction)[];
        }
      }
    },

    setTransactionStatusToCanceled(
      state: IVaultState,
      action: PayloadAction<{
        chainID: number;
        txHash: string;
      }>
    ) {
      const { txHash, chainID } = action.payload;

      const { isBitcoinBased, activeAccount, isNetworkChanging } = state;

      const { id, type } = activeAccount;

      if (!state.accounts[type][id]) {
        throw new Error(
          'Unable to change Transaction to Canceled. Account not found'
        );
      }

      if (isNetworkChanging || isBitcoinBased) {
        return;
      }

      const currentUserTransactions = state.accounts[type][id].transactions[
        TransactionsType.Ethereum
      ][chainID] as IEvmTransactionResponse[];

      const findTxIndex = currentUserTransactions.findIndex(
        (tx: IEvmTransactionResponse) => tx.hash === txHash
      );

      state.accounts[type][id].transactions[TransactionsType.Ethereum][chainID][
        findTxIndex
      ] = {
        ...state.accounts[type][id].transactions[TransactionsType.Ethereum][
          chainID
        ][findTxIndex],
        isCanceled: true,
      } as IEvmTransactionResponse;
    },

    setTransactionStatusToAccelerated(
      state: IVaultState,
      action: PayloadAction<{
        chainID: number;
        oldTxHash: string;
      }>
    ) {
      const { oldTxHash, chainID } = action.payload;

      const { isBitcoinBased, activeAccount, isNetworkChanging } = state;

      const { id, type } = activeAccount;

      if (!state.accounts[type][id]) {
        throw new Error(
          'Unable to replace the accelerated Transaction. Account not found'
        );
      }

      if (isNetworkChanging || isBitcoinBased) {
        return;
      }

      const userTransactions = state.accounts[type][id].transactions[
        TransactionsType.Ethereum
      ][chainID] as IEvmTransaction[];

      const removedTx = userTransactions.filter(
        (tx) => tx.hash !== oldTxHash
      ) as IEvmTransaction[];

      state.accounts[type][id].transactions[TransactionsType.Ethereum][
        chainID
      ] = removedTx;
    },
  },
});

export const {
  setAccounts,
  setAccountsWithLabelEdited,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setActiveAccountProperty,
  setEditedEvmToken,
  setNetworkType,
  setNetworkChange,
  setAccountTypeInAccountsObject,
  setActiveNetwork,
  setIsNetworkChanging,
  setIsLoadingBalances,
  setIsLoadingAssets,
  setIsLoadingTxs,
  setIsLoadingNfts,
  setOpenDAppErrorModal,
  setAccountBalances,
  setChangingConnectedAccount,
  setLastLogin,
  setNetworks,
  setTimer,
  setIsTimerEnabled,
  forgetWallet,
  removeAccount,
  setHasEthProperty,
  removeAccounts,
  removeNetwork,
  createAccount,
  setAccountLabel,
  setStoreError,
  setIsBitcoinBased,
  setUpdatedAllErcTokensBalance,
  setUpdatedNftsToState,
  setAdvancedSettings,
  setIsPolling,
  setCurrentBlock,
  setSingleTransactionToState,
  setMultipleTransactionToState,
  setTransactionStatusToCanceled,
  setTransactionStatusToAccelerated,
  setCoinsList,
} = VaultState.actions;

export default VaultState.reducer;
