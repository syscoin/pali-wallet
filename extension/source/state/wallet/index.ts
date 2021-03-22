import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from '@stardust-collective/dag4-network';

import { DAG_NETWORK } from 'constants/index';
import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  Keystore,
  AccountType,
} from './types';

const initialState: IWalletState = {
  keystores: {},
  status: 0,
  accounts: {},
  activeAccountId: '0',
  seedKeystoreId: '',
  activeNetwork: DAG_NETWORK.main.id,
  index: 0
};

// createSlice comes with immer produce so we don't need to take care of immutational update
const WalletState = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setKeystoreInfo(state: IWalletState, action: PayloadAction<Keystore>) {
      state.keystores = {
        ...state.keystores,
        [action.payload.id]: action.payload,
      };
    },
    removeKeystoreInfo(state: IWalletState, action: PayloadAction<string>) {
      if (state.keystores[action.payload])
        delete state.keystores[action.payload];
    },
    updateSeedKeystoreId(state: IWalletState, action: PayloadAction<string>) {
      if (state.keystores && state.keystores[state.seedKeystoreId]) {
        delete state.keystores[state.seedKeystoreId];
      }
      state.seedKeystoreId = action.payload;
    },
    updateStatus(state: IWalletState) {
      state.status = Date.now();
    },
    createAccount(state: IWalletState, action: PayloadAction<IAccountState>) {
      return {
        ...state,
        accounts: {
          ...state.accounts,
          [action.payload.id]: action.payload,
        },
        activeAccountId: action.payload.id,
      };
    },
    removeAccount(state: IWalletState, action: PayloadAction<string>) {
      if (Object.keys(state.accounts).length <= 1) return;
      if (state.activeAccountId === action.payload) {
        state.activeAccountId = Object.values(state.accounts)[0].id;
      }
      delete state.accounts[action.payload];
    },
    removeSeedAccounts(state: IWalletState) {
      Object.values(state.accounts).forEach((account) => {
        if (account.type === AccountType.Seed)
          delete state.accounts[account.id];
      });
      state.activeAccountId = '0';
    },
    updateAccount(
      state: IWalletState,
      action: PayloadAction<IAccountUpdateState>
    ) {
      state.accounts[action.payload.id] = {
        ...state.accounts[action.payload.id],
        ...action.payload,
      };
    },
    deleteWallet(state: IWalletState) {
      state.keystores = {};
      state.accounts = {};
      state.seedKeystoreId = '';
      state.activeAccountId = '0';
      state.activeNetwork = DAG_NETWORK.main.id;
    },
    changeAccountActiveId(state: IWalletState, action: PayloadAction<string>) {
      state.activeAccountId = action.payload;
    },
    changeActiveNetwork(state: IWalletState, action: PayloadAction<string>) {
      state.activeNetwork = action.payload;
    },
    updateTransactions(
      state: IWalletState,
      action: PayloadAction<{ id: string; txs: Transaction[] }>
    ) {
      state.accounts[action.payload.id].transactions = action.payload.txs;
    },
    updateLabel(
      state: IWalletState,
      action: PayloadAction<{ id: string; label: string }>
    ) {
      state.accounts[action.payload.id].label = action.payload.label;
    },
  },
});

export const {
  setKeystoreInfo,
  removeKeystoreInfo,
  updateStatus,
  createAccount,
  removeAccount,
  removeSeedAccounts,
  deleteWallet,
  updateSeedKeystoreId,
  changeAccountActiveId,
  changeActiveNetwork,
  updateAccount,
  updateTransactions,
  updateLabel,
} = WalletState.actions;

export default WalletState.reducer;
