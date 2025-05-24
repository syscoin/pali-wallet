import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ethers } from 'ethers';
import cloneDeep from 'lodash/cloneDeep';
import take from 'lodash/take';

import {
  IKeyringBalances,
  initialActiveHdAccountState,
  initialActiveImportedAccountState,
  initialActiveTrezorAccountState,
  IWalletState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import {
  IEvmTransaction,
  IEvmTransactionResponse,
  ISysTransaction,
  TransactionValueType,
} from 'scripts/Background/controllers/transactions/types';
import { convertTransactionValueToCompare } from 'scripts/Background/controllers/transactions/utils';
import { ITokenEthProps } from 'types/tokens';
import {
  PALI_NETWORKS_STATE,
  SYSCOIN_MAINNET_DEFAULT_NETWORK,
} from 'utils/constants';
import { chromeStorage } from 'utils/storageAPI';
import { isTokenTransfer } from 'utils/transactions';

import {
  IChangingConnectedAccount,
  IPaliAccount,
  IVaultState,
  PaliAccount,
  TransactionsType,
  INetworkWithKind,
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
  },
  activeAccount: {
    id: 0,
    type: KeyringAccountType.HDAccount,
  },
  advancedSettings: {
    refresh: false,
    ledger: false,
  },
  isLastTxConfirmed: {},
  hasEthProperty: true,
  hasEncryptedVault: false,
  activeChain: INetworkType.Syscoin,
  activeNetwork: SYSCOIN_MAINNET_DEFAULT_NETWORK.network,
  hasErrorOndAppEVM: false,
  isBitcoinBased: true,
  isDappAskingToChangeNetwork: false,
  isLoadingBalances: false,
  isLoadingTxs: false,
  isLoadingAssets: false,
  isLoadingNfts: false,
  changingConnectedAccount: {
    host: undefined,
    isChangingConnectedAccount: false,
    newConnectedAccount: undefined,
    connectedAccountType: undefined,
  },
  networks: PALI_NETWORKS_STATE,
  error: null,
  isPolling: false,
  currentBlock: undefined,
  coinsList: [],
  shouldShowFaucetModal: {
    57: true,
    570: true,
    5700: true,
    57000: true,
  },
  prevBalances: {
    [0]: {
      [INetworkType.Ethereum]: {},
      [INetworkType.Syscoin]: {},
    },
  },
  networkStatus: 'idle',
  networkTarget: undefined,
};

export const getHasEncryptedVault = createAsyncThunk(
  'vault/getHasEncryptedVault',
  async () => {
    const hasEncryptedVault = await chromeStorage.getItem('sysweb3-vault');
    return !!hasEncryptedVault;
  }
);

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    rehydrate(state: IVaultState, action: PayloadAction<IVaultState>) {
      return {
        ...state,
        ...action.payload,
      };
    },
    setAccounts(
      state: IVaultState,
      action: PayloadAction<{
        [key in KeyringAccountType]: PaliAccount;
      }>
    ) {
      state.accounts = action.payload;
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

      // Find the correct network with kind property from our networks state
      const networksInChain =
        activeChain === INetworkType.Syscoin
          ? state.networks.syscoin
          : state.networks.ethereum;
      const networkWithKind = Object.values(networksInChain).find(
        (network) =>
          network.chainId === wallet.activeNetwork.chainId &&
          network.url === wallet.activeNetwork.url
      );

      // Use the network with proper kind property, falling back to wallet network with inferred kind
      state.activeNetwork =
        networkWithKind ||
        ({
          ...wallet.activeNetwork,
          kind: activeChain === INetworkType.Syscoin ? 'utxo' : 'evm',
        } as INetworkWithKind);

      state.activeAccount = {
        id: wallet.activeAccountId,
        type: wallet.activeAccountType,
      };
      state.networks = state.networks;
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
    setIsLastTxConfirmed(
      state: IVaultState,
      action: PayloadAction<{
        chainId: number;
        isFirstTime?: boolean;
        wasConfirmed: boolean;
      }>
    ) {
      const { chainId, wasConfirmed, isFirstTime } = action.payload;
      if (isFirstTime) {
        state.isLastTxConfirmed = {};
        return;
      }
      state.isLastTxConfirmed[chainId] = wasConfirmed;
    },
    setNetwork(
      state: IVaultState,
      action: PayloadAction<{
        chain: string;
        isEdit?: boolean;
        isFirstTime?: boolean;
        network: INetworkWithKind;
      }>
    ) {
      const { chain, network, isEdit, isFirstTime } = action.payload;
      const networkKeyIdentifier = network.key ? network.key : network.chainId;

      if (state.networks[chain][networkKeyIdentifier]) {
        if (!isEdit && !isFirstTime) {
          throw new Error('Network already exists!');
        }
        if (isEdit) {
          state.networks[chain][networkKeyIdentifier] = {
            ...state.networks[chain][networkKeyIdentifier],
            ...network,
          };
        }
        return;
      }
      state.networks[chain][networkKeyIdentifier] = network;

      if (
        chain === state.activeChain &&
        network.chainId === state.activeNetwork.chainId &&
        network.url === state.activeNetwork.url
      ) {
        state.activeNetwork = network;
      }
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

      const clonedNetworks = cloneDeep(state.networks[chain]);

      if (key && clonedNetworks[key]) {
        delete clonedNetworks[key];
      } else {
        const networkToDeleteKey = Object.keys(clonedNetworks).find(
          (networkKey) => {
            const network = clonedNetworks[networkKey];
            return (
              network.url === rpcUrl &&
              network.chainId === chainId &&
              network.label === label
            );
          }
        );

        if (networkToDeleteKey) {
          delete clonedNetworks[networkToDeleteKey];
        }
      }

      state.networks[chain] = clonedNetworks;
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
    setActiveNetwork(
      state: IVaultState,
      action: PayloadAction<INetworkWithKind>
    ) {
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
    setIsDappAskingToChangeNetwork(
      state: IVaultState,
      action: PayloadAction<boolean>
    ) {
      state.isDappAskingToChangeNetwork = action.payload;
    },
    setOpenDAppErrorModal(state: IVaultState, action: PayloadAction<boolean>) {
      state.hasErrorOndAppEVM = action.payload;
    },
    setCongratulationsModalOnImportWallet(
      state: IVaultState,
      action: PayloadAction<boolean>
    ) {
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
    setStoreError(state: IVaultState, action: PayloadAction<string | null>) {
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
      const { isBitcoinBased, accounts, activeAccount } = state;
      const { type, id } = activeAccount;
      const findAccount = accounts[type][id];

      if (
        !Boolean(
          findAccount.address === accounts[type][id].address || isBitcoinBased
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
          // If the chainId exists, check for duplicates before adding
          const currentUserTransactions = currentAccount.transactions[
            networkType
          ][chainId] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[];

          // Get the transaction hash/txid
          const isEvmTx = (
            tx: IEvmTransaction | ISysTransaction
          ): tx is IEvmTransaction => 'hash' in tx;
          const newTxId: string = isEvmTx(transaction)
            ? transaction.hash
            : transaction.txid;

          // Check if transaction already exists
          const existingTxIndex = currentUserTransactions.findIndex((tx) => {
            const txId: string = isEvmTx(tx) ? tx.hash : tx.txid;
            return txId.toLowerCase() === newTxId.toLowerCase();
          });

          if (existingTxIndex !== -1) {
            // Transaction already exists, update it if the new one has more confirmations
            const existingTx = currentUserTransactions[existingTxIndex];
            if (transaction.confirmations > existingTx.confirmations) {
              currentUserTransactions[existingTxIndex] = transaction as any;
            }
          } else {
            // New transaction, add it
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
              // If the array length is less than 30, simply add the new transaction at the beginning
              currentUserTransactions.unshift(
                transaction as typeof networkType extends TransactionsType.Ethereum
                  ? IEvmTransaction
                  : ISysTransaction
              );
            }
          }
        }
      }
    },

    setMultipleTransactionToState(
      state: IVaultState,
      action: PayloadAction<{
        accountId?: number;
        accountType?: KeyringAccountType;
        chainId: number;
        networkType: TransactionsType;
        transactions: Array<IEvmTransaction | ISysTransaction>;
      }>
    ) {
      const { activeAccount, isBitcoinBased } = state;
      const { networkType, chainId, transactions, accountId, accountType } =
        action.payload;

      // Use provided account info if available, otherwise use active account
      const targetAccountType = accountType ?? activeAccount.type;
      const targetAccountId = accountId ?? activeAccount.id;

      const currentAccount = state.accounts[targetAccountType][targetAccountId];

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
            const shouldNotBeAdded =
              convertTransactionValueToCompare(
                tx.value as TransactionValueType
              ) === 0 && !isTokenTransfer(tx as IEvmTransactionResponse);

            if (shouldNotBeAdded) {
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
              const shouldNotBeAdded =
                convertTransactionValueToCompare(
                  tx.value as TransactionValueType
                ) === 0 && !isTokenTransfer(tx as IEvmTransactionResponse);

              if (shouldNotBeAdded) {
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
              const shouldNotBeAdded =
                convertTransactionValueToCompare(
                  tx.value as TransactionValueType
                ) === 0 && !isTokenTransfer(tx as IEvmTransactionResponse);

              if (shouldNotBeAdded) {
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

      const { isBitcoinBased, activeAccount } = state;

      const { id, type } = activeAccount;

      if (!state.accounts[type][id]) {
        throw new Error(
          'Unable to change Transaction to Canceled. Account not found'
        );
      }

      if (isBitcoinBased) {
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

    setFaucetModalState: (
      state: IVaultState,
      action: PayloadAction<{ chainId: number; isOpen: boolean }>
    ) => {
      const { chainId, isOpen } = action.payload;
      if (state.isBitcoinBased) {
        return;
      }

      state.shouldShowFaucetModal[chainId] = isOpen;
    },

    setTransactionStatusToAccelerated(
      state: IVaultState,
      action: PayloadAction<{
        chainID: number;
        oldTxHash: string;
      }>
    ) {
      const { oldTxHash, chainID } = action.payload;

      const { isBitcoinBased, activeAccount } = state;

      const { id, type } = activeAccount;

      if (!state.accounts[type][id]) {
        throw new Error(
          'Unable to replace the accelerated Transaction. Account not found'
        );
      }

      if (isBitcoinBased) {
        return;
      }

      const userTransactions = state.accounts[type][id].transactions[
        TransactionsType.Ethereum
      ][chainID] as IEvmTransaction[];

      state.accounts[type][id].transactions[TransactionsType.Ethereum][
        chainID
      ] = userTransactions.filter(
        (tx) => tx.hash !== oldTxHash
      ) as IEvmTransaction[];
    },
    setPrevBalances(
      state: IVaultState,
      action: PayloadAction<{
        activeAccountId: number;
        balance: number;
        chain: INetworkType;
        chainId: number;
      }>
    ) {
      const { activeAccountId, chain, chainId, balance } = action.payload;

      if (!state.prevBalances[activeAccountId]) {
        state.prevBalances[activeAccountId] = {
          [INetworkType.Ethereum]: {},
          [INetworkType.Syscoin]: {},
        };
      }

      if (!state.prevBalances[activeAccountId][chain]) {
        state.prevBalances[activeAccountId][chain] = {};
      }

      state.prevBalances[activeAccountId][chain][chainId] = balance;
    },
    startSwitchNetwork(
      state: IVaultState,
      action: PayloadAction<INetworkWithKind>
    ) {
      state.networkStatus = 'switching';
      state.networkTarget = action.payload;
    },
    switchNetworkSuccess(
      state: IVaultState,
      action: PayloadAction<INetworkWithKind>
    ) {
      state.activeNetwork = action.payload;
      state.networkStatus = 'idle';
      state.networkTarget = undefined;
    },
    switchNetworkError(state: IVaultState) {
      state.networkStatus = 'error';
    },
    resetNetworkStatus(state: IVaultState) {
      state.networkStatus = 'idle';
      state.networkTarget = undefined;
    },
  },

  extraReducers: (builder) => {
    builder.addCase(getHasEncryptedVault.fulfilled, (state, action) => {
      state.hasEncryptedVault = action.payload;
    });
  },
});

export const {
  rehydrate,
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
  setIsDappAskingToChangeNetwork,
  setFaucetModalState,
  setIsLoadingBalances,
  setIsLoadingAssets,
  setIsLoadingTxs,
  setIsLoadingNfts,
  setOpenDAppErrorModal,
  setAccountBalances,
  setChangingConnectedAccount,
  setLastLogin,
  setNetwork,
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
  setIsLastTxConfirmed,
  setPrevBalances,
  startSwitchNetwork,
  switchNetworkSuccess,
  switchNetworkError,
  resetNetworkStatus,
} = VaultState.actions;

export default VaultState.reducer;
