import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import take from 'lodash/take';

import {
  IEvmTransaction,
  IEvmTransactionResponse,
  ISysTransaction,
} from 'scripts/Background/controllers/transactions/types';
import {
  KeyringAccountType,
  IKeyringAccountState,
  INetwork,
  INetworkType,
  IKeyringBalances,
  initialActiveHdAccountState,
} from 'types/network';
import { SYSCOIN_UTXO_MAINNET_NETWORK } from 'utils/constants';

import {
  IVaultState,
  TransactionsType,
  IAccountAssets,
  IAccountTransactions,
} from './types';

const initialState: IVaultState = {
  accounts: {
    [KeyringAccountType.HDAccount]: {
      [initialActiveHdAccountState.id]: {
        ...initialActiveHdAccountState,
        balances: {
          ethereum: -1,
          syscoin: -1,
        },
      },
    },
    [KeyringAccountType.Imported]: {},
    [KeyringAccountType.Trezor]: {},
    [KeyringAccountType.Ledger]: {},
  },
  accountAssets: {
    [KeyringAccountType.HDAccount]: {
      [initialActiveHdAccountState.id]: {
        ethereum: [],
        syscoin: [],
      },
    },
    [KeyringAccountType.Imported]: {},
    [KeyringAccountType.Trezor]: {},
    [KeyringAccountType.Ledger]: {},
  },
  accountTransactions: {
    [KeyringAccountType.HDAccount]: {
      [initialActiveHdAccountState.id]: {
        ethereum: {},
        syscoin: {},
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
  activeChain: INetworkType.Syscoin,
  activeNetwork: SYSCOIN_UTXO_MAINNET_NETWORK,
  isBitcoinBased: true,
  shouldShowFaucetModal: {
    57: true,
    570: true,
    5700: true,
    57000: true,
  },
};

const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    rehydrate(_state: IVaultState, action: PayloadAction<IVaultState>) {
      // Complete replacement - ensures loaded vault state is exactly what was saved
      // This matches the behavior of initializeCleanVaultForSlip44 for consistency
      return action.payload;
    },
    setAccounts(
      state: IVaultState,
      action: PayloadAction<{
        [key in KeyringAccountType]: { [id: number]: IKeyringAccountState };
      }>
    ) {
      // Just set the clean accounts - assets/transactions are managed separately
      state.accounts = action.payload;
    },
    setAccountLabel(
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        label: string;
      }>
    ) {
      const { label, accountId, accountType } = action.payload;
      if (state.accounts[accountType]?.[accountId]) {
        state.accounts[accountType][accountId].label = label;
      }
    },
    setNetworkChange(
      state: IVaultState,
      action: PayloadAction<{
        activeNetwork: INetwork;
      }>
    ) {
      const { activeNetwork } = action.payload;

      state.activeChain = activeNetwork.kind;
      state.isBitcoinBased = activeNetwork.kind === INetworkType.Syscoin;

      // Clear ALL accounts' balances when switching networks
      // Use -1 to indicate "no data" - will show skeleton loader
      Object.keys(KeyringAccountType).forEach((accountType) => {
        const accounts = state.accounts[accountType as KeyringAccountType];
        if (accounts) {
          Object.keys(accounts).forEach((accountId) => {
            const id = Number(accountId);
            if (state.accounts[accountType as KeyringAccountType][id]) {
              state.accounts[accountType as KeyringAccountType][id].balances = {
                [INetworkType.Syscoin]: -1,
                [INetworkType.Ethereum]: -1,
              };
            }
          });
        }
      });

      state.activeNetwork = activeNetwork;
    },
    setAccountBalances(
      state: IVaultState,
      action: PayloadAction<IKeyringBalances>
    ) {
      const { id, type } = state.activeAccount;

      if (state.accounts[type]?.[id]) {
        state.accounts[type][id].balances = action.payload;
      }
    },
    createAccount(
      state: IVaultState,
      action: PayloadAction<{
        account: IKeyringAccountState;
        accountType: KeyringAccountType;
        assets?: IAccountAssets;
        transactions?: IAccountTransactions;
      }>
    ) {
      const { account, accountType, assets, transactions } = action.payload;

      // Override the initial balances to -1 (indicating "no data")
      const accountWithInitialBalances = {
        ...account,
        balances: {
          [INetworkType.Syscoin]: -1,
          [INetworkType.Ethereum]: -1,
        },
      };

      // Set the clean account data
      state.accounts[accountType][account.id] = accountWithInitialBalances;

      // Set up accountAssets
      if (!state.accountAssets[accountType]) {
        state.accountAssets[accountType] = {};
      }
      state.accountAssets[accountType][account.id] = assets || {
        ethereum: [],
        syscoin: [],
      };

      // Set up accountTransactions
      if (!state.accountTransactions[accountType]) {
        state.accountTransactions[accountType] = {};
      }
      state.accountTransactions[accountType][account.id] = transactions || {
        ethereum: {},
        syscoin: {},
      };
    },
    setActiveAccount(
      state: IVaultState,
      action: PayloadAction<{
        id: number;
        type: KeyringAccountType;
      }>
    ) {
      state.activeAccount = action.payload;
    },
    setActiveNetwork(state: IVaultState, action: PayloadAction<INetwork>) {
      state.activeNetwork = action.payload;
    },
    setNetworkType(state: IVaultState, action: PayloadAction<INetworkType>) {
      state.activeChain = action.payload;
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

      if (!state.accounts[type][id]) throw new Error('Account not found');

      // Don't allow setting assets or transactions through this reducer
      if (property === 'assets' || property === 'transactions') {
        throw new Error('Use dedicated asset/transaction reducers instead');
      }

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

      // Don't allow setting assets or transactions through this reducer
      if (property === 'assets' || property === 'transactions') {
        throw new Error('Use dedicated asset/transaction reducers instead');
      }

      if (!(property in state.accounts[type][id]))
        throw new Error('Unable to set property. Unknown key');

      state.accounts[type][id][property] = value;
    },
    forgetWallet() {
      return initialState;
    },
    initializeCleanVaultForSlip44(
      state: IVaultState,
      action: PayloadAction<INetwork>
    ) {
      const network = action.payload;

      // Create TRULY clean state - NO accounts, assets, or transactions
      const cleanState: IVaultState = {
        accounts: {
          [KeyringAccountType.HDAccount]: {}, // 🔥 EMPTY - no default accounts!
          [KeyringAccountType.Imported]: {},
          [KeyringAccountType.Trezor]: {},
          [KeyringAccountType.Ledger]: {},
        },
        accountAssets: {
          [KeyringAccountType.HDAccount]: {}, // 🔥 EMPTY - no default assets!
          [KeyringAccountType.Imported]: {},
          [KeyringAccountType.Trezor]: {},
          [KeyringAccountType.Ledger]: {},
        },
        accountTransactions: {
          [KeyringAccountType.HDAccount]: {}, // 🔥 EMPTY - no default transactions!
          [KeyringAccountType.Imported]: {},
          [KeyringAccountType.Trezor]: {},
          [KeyringAccountType.Ledger]: {},
        },
        activeAccount: {
          id: 0, // Will be updated when first account is created
          type: KeyringAccountType.HDAccount,
        },
        activeChain: network.kind,
        activeNetwork: network,
        isBitcoinBased: network.kind === INetworkType.Syscoin,
        shouldShowFaucetModal: {
          57: true,
          570: true,
          5700: true,
          57000: true,
        },
      };

      return cleanState;
    },
    removeAccounts(state: IVaultState) {
      state.accounts = {
        [KeyringAccountType.HDAccount]: {
          [initialActiveHdAccountState.id]: {
            ...initialActiveHdAccountState,
            balances: {
              ethereum: -1,
              syscoin: -1,
            },
          },
        },
        [KeyringAccountType.Imported]: {},
        [KeyringAccountType.Trezor]: {},
        [KeyringAccountType.Ledger]: {},
      };
      state.accountAssets = {
        [KeyringAccountType.HDAccount]: {
          [initialActiveHdAccountState.id]: {
            ethereum: [],
            syscoin: [],
          },
        },
        [KeyringAccountType.Imported]: {},
        [KeyringAccountType.Trezor]: {},
        [KeyringAccountType.Ledger]: {},
      };
      state.accountTransactions = {
        [KeyringAccountType.HDAccount]: {
          [initialActiveHdAccountState.id]: {
            ethereum: {},
            syscoin: {},
          },
        },
        [KeyringAccountType.Imported]: {},
        [KeyringAccountType.Trezor]: {},
        [KeyringAccountType.Ledger]: {},
      };
      state.activeAccount = { id: 0, type: KeyringAccountType.HDAccount };
    },
    removeAccount(
      state: IVaultState,
      action: PayloadAction<{ id: number; type: KeyringAccountType }>
    ) {
      const { id, type } = action.payload;
      delete state.accounts[type][id];

      // Also clean up assets and transactions
      if (state.accountAssets[type]) {
        delete state.accountAssets[type][id];
      }
      if (state.accountTransactions[type]) {
        delete state.accountTransactions[type][id];
      }
    },

    setIsBitcoinBased(state: IVaultState, action: PayloadAction<boolean>) {
      state.isBitcoinBased = action.payload;
    },

    setAccountAssets: (
      state: IVaultState,
      action: PayloadAction<{
        accountId: number;
        accountType: KeyringAccountType;
        // 'ethereum' | 'syscoin'
        assets?: IAccountAssets;
        property?: keyof IAccountAssets; // For full replacement
        value?: any; // For property-specific updates
      }>
    ) => {
      const { accountId, accountType, property, assets, value } =
        action.payload;

      // Ensure accountAssets exists for this account
      if (!state.accountAssets[accountType]) {
        state.accountAssets[accountType] = {};
      }
      if (!state.accountAssets[accountType][accountId]) {
        state.accountAssets[accountType][accountId] = {
          ethereum: [],
          syscoin: [],
        };
      }

      if (property && value !== undefined) {
        // Update specific property
        state.accountAssets[accountType][accountId][property] = value;
      } else if (assets) {
        // Full replacement
        state.accountAssets[accountType][accountId] = assets;
      }
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

      // Ensure accountTransactions exists for this account
      if (!state.accountTransactions[activeAccount.type]) {
        state.accountTransactions[activeAccount.type] = {};
      }
      if (!state.accountTransactions[activeAccount.type][activeAccount.id]) {
        state.accountTransactions[activeAccount.type][activeAccount.id] = {
          ethereum: {},
          syscoin: {},
        };
      }

      const currentAccountTransactions =
        state.accountTransactions[activeAccount.type][activeAccount.id];

      // Check if the networkType exists in the current account's transactions
      if (!currentAccountTransactions[networkType]) {
        currentAccountTransactions[networkType] = {
          [chainId]: [
            transaction,
          ] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[],
        } as any;
      } else {
        // Check if the chainId exists in the current networkType's transactions
        if (!currentAccountTransactions[networkType][chainId]) {
          currentAccountTransactions[networkType][chainId] = [
            transaction,
          ] as (typeof networkType extends TransactionsType.Ethereum
            ? IEvmTransaction
            : ISysTransaction)[];
        } else {
          // If the chainId exists, check for duplicates before adding
          const currentUserTransactions = currentAccountTransactions[
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

              currentAccountTransactions[networkType][chainId] =
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
    // Simple setter for transactions - no processing, just set the array
    setAccountTransactions(
      state: IVaultState,
      action: PayloadAction<{
        accountId?: number;
        accountType?: KeyringAccountType;
        chainId: number;
        networkType: TransactionsType;
        transactions: Array<IEvmTransaction | ISysTransaction>;
      }>
    ) {
      const { activeAccount } = state;
      const { networkType, chainId, transactions, accountId, accountType } =
        action.payload;

      // Use provided account info if available, otherwise use active account
      const targetAccountType = accountType ?? activeAccount.type;
      const targetAccountId = accountId ?? activeAccount.id;

      // Ensure accountTransactions exists for this account
      if (!state.accountTransactions[targetAccountType]) {
        state.accountTransactions[targetAccountType] = {};
      }
      if (!state.accountTransactions[targetAccountType][targetAccountId]) {
        state.accountTransactions[targetAccountType][targetAccountId] = {
          ethereum: {},
          syscoin: {},
        };
      }

      const currentAccountTransactions =
        state.accountTransactions[targetAccountType][targetAccountId];

      // Simply set the transactions array - all processing is done before dispatch
      if (!currentAccountTransactions[networkType]) {
        currentAccountTransactions[networkType] = {
          [chainId]: transactions as any,
        };
      } else {
        currentAccountTransactions[networkType][chainId] = transactions as any;
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

      // Ensure accountTransactions exists
      if (!state.accountTransactions[type]) {
        state.accountTransactions[type] = {};
      }
      if (!state.accountTransactions[type][id]) {
        state.accountTransactions[type][id] = {
          ethereum: {},
          syscoin: {},
        };
      }

      const currentUserTransactions = state.accountTransactions[type][id][
        TransactionsType.Ethereum
      ][chainID] as IEvmTransactionResponse[];

      if (!currentUserTransactions) {
        return; // No transactions to cancel
      }

      const findTxIndex = currentUserTransactions.findIndex(
        (tx: IEvmTransactionResponse) => tx.hash === txHash
      );

      if (findTxIndex !== -1) {
        state.accountTransactions[type][id][TransactionsType.Ethereum][chainID][
          findTxIndex
        ] = {
          ...state.accountTransactions[type][id][TransactionsType.Ethereum][
            chainID
          ][findTxIndex],
          isCanceled: true,
        } as IEvmTransactionResponse;
      }
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

      // Ensure accountTransactions exists
      if (!state.accountTransactions[type]) {
        state.accountTransactions[type] = {};
      }
      if (!state.accountTransactions[type][id]) {
        state.accountTransactions[type][id] = {
          ethereum: {},
          syscoin: {},
        };
      }

      const userTransactions = state.accountTransactions[type][id][
        TransactionsType.Ethereum
      ][chainID] as IEvmTransaction[];

      if (userTransactions) {
        // Mark the old transaction as replaced (but don't remove it yet)
        const txIndex = userTransactions.findIndex(
          (tx) => tx.hash.toLowerCase() === oldTxHash.toLowerCase()
        );

        if (txIndex !== -1) {
          // Mark the old transaction as replaced/superseded
          userTransactions[txIndex] = {
            ...userTransactions[txIndex],
            isReplaced: true,
            status: 'replaced',
          } as IEvmTransaction;
        }
      }
    },
  },
});

export const {
  rehydrate,
  setAccountPropertyByIdAndType,
  setActiveAccount,
  setActiveAccountProperty,
  setNetworkChange,
  setNetworkType,
  setAccountTypeInAccountsObject,
  setActiveNetwork,
  setFaucetModalState,
  setAccountBalances,
  forgetWallet,
  initializeCleanVaultForSlip44,
  removeAccount,
  removeAccounts,
  createAccount,
  setAccountLabel,
  setIsBitcoinBased,
  setAccountAssets,
  setSingleTransactionToState,
  setAccountTransactions,
  setTransactionStatusToCanceled,
  setTransactionStatusToAccelerated,
  setAccounts,
} = VaultState.actions;

export default VaultState.reducer;

// Export selectors
export * from './selectors';
