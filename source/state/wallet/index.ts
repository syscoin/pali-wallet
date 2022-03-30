import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from 'types/transactions';

import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  IAccountUpdateAddress,
  IAccountUpdateXpub,
  IWalletTokenState,
  INetwork,
} from './types';

export const initialState: IWalletState = {
  accounts: [],
  activeAccountId: 0,
  changingNetwork: false,
  walletTokens: [],
  networks: {
    main: {
      id: 'main',
      label: 'Main Network',
      beUrl: 'https://blockbook.elint.services/',
    },
    testnet: {
      id: 'testnet',
      label: 'Test Network',
      beUrl: 'https://blockbook-dev.elint.services/',
    },
  },
};

const WalletState = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    updateNetwork(state: IWalletState, action: PayloadAction<INetwork>) {
      return {
        ...state,
        networks: {
          ...state.networks,
          [action.payload.id]: action.payload,
        },
      };
    },
    // update token by accountId (if existent) or add a new one
    updateAllTokens(state, action: PayloadAction<IWalletTokenState>) {
      const tokenIndex: number = state.walletTokens.findIndex(
        (token) => token.accountId === action.payload.accountId
      );

      if (tokenIndex > -1) {
        state.walletTokens[tokenIndex] = action.payload;
      } else {
        state.walletTokens.push(action.payload);
      }
    },
    createAccount(state: IWalletState, action: PayloadAction<IAccountState>) {
      return {
        ...state,
        accounts: [...state.accounts, action.payload],
      };
    },
    removeAccount(state: IWalletState, action: PayloadAction<number>) {
      if (state.accounts.length <= 1) {
        return;
      }

      const accountIndex = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload
      );

      if (state.activeAccountId === action.payload) {
        state.activeAccountId = state.accounts[0].id;
      }

      const infoIndex = state.walletTokens.findIndex(
        (element: any) => element.accountId === action.payload
      );

      state.walletTokens.splice(infoIndex, 1);
      state.accounts.splice(accountIndex, 1);
    },
    // todo: remove this for vault
    removeAccounts(state: IWalletState) {
      state.accounts = [];
      state.activeAccountId = 0;
    },
    updateAccount(
      state: IWalletState,
      action: PayloadAction<IAccountUpdateState>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      if (indexOf === -1) return;

      state.accounts[indexOf] = {
        ...state.accounts[indexOf],
        ...action.payload,
      };
    },

    updateAccountAddress(
      state: IWalletState,
      action: PayloadAction<IAccountUpdateAddress>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      state.accounts[indexOf] = {
        ...state.accounts[indexOf],
        ...action.payload,
      };
    },
    updateAccountXpub(
      state: IWalletState,
      action: PayloadAction<IAccountUpdateXpub>
    ) {
      const accountIndex = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      if (accountIndex === -1) return;

      state.accounts[accountIndex] = {
        ...state.accounts[action.payload.id],
        ...action.payload,
      };
    },
    forgetWallet() {
      return initialState;
    },
    changeAccountActiveId(state: IWalletState, action: PayloadAction<number>) {
      state.activeAccountId = action.payload;
    },
    updateTransactions(
      state: IWalletState,
      action: PayloadAction<{ id: number; txs: Transaction[] }>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      if (indexOf === -1) return;

      state.accounts[indexOf].transactions = action.payload.txs;
    },
    updateLabel(
      state: IWalletState,
      action: PayloadAction<{ id: number; label: string }>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      state.accounts[indexOf].label = action.payload.label;
    },
  },
});

export const {
  createAccount,
  removeAccount,
  removeAccounts,
  forgetWallet,
  changeAccountActiveId,
  updateAccount,
  updateTransactions,
  updateLabel,
  updateAccountAddress,
  updateAccountXpub,
  updateAllTokens,
  updateNetwork,
} = WalletState.actions;

export default WalletState.reducer;
