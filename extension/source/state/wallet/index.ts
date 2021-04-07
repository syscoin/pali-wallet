import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from '../../scripts/types';

import { SYS_NETWORK } from 'constants/index';
import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  Keystore,
  IAccountUpdateAddress,
} from './types';

const initialState: IWalletState = {
  keystores: [],
  status: 0,
  accounts: [],
  activeAccountId: 0,
  seedKeystoreId: -1,
  activeNetwork: SYS_NETWORK.main.id,
  encriptedMnemonic: null
};

const WalletState = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setKeystoreInfo(state: IWalletState, action: PayloadAction<Keystore>) {
      return {
        ...state,
        keystores: [
          ...state.keystores,
          action.payload
        ]
      };
    },
    setEncriptedMnemonic(state: IWalletState, action: PayloadAction<CryptoJS.lib.CipherParams>) {
      state.encriptedMnemonic = action.payload.toString();
    },
    removeKeystoreInfo(state: IWalletState, action: PayloadAction<number>) {
      if (state.keystores[action.payload]) {
        state.keystores.splice(action.payload, 1);
      }
    },
    updateSeedKeystoreId(state: IWalletState, action: PayloadAction<number>) {
      if (state.keystores && state.keystores[state.seedKeystoreId]) {
        state.keystores.splice(state.seedKeystoreId, 1);
      }
      state.seedKeystoreId = action.payload;
    },
    updateStatus(state: IWalletState) {
      state.status = Date.now();
    },
    createAccount(state: IWalletState, action: PayloadAction<IAccountState>) {
      return {
        ...state,
        accounts: [
          ...state.accounts,
          action.payload
        ]
      };
    },
    removeAccount(state: IWalletState, action: PayloadAction<number>) {
      if (state.accounts.length <= 1) {
        return;
      }

      if (state.activeAccountId === action.payload) {
        state.activeAccountId = state.accounts[0].id;
      }

      state.accounts.splice(action.payload, 1);
      state.activeAccountId = 0;
    },

    removeAccounts(state: IWalletState) {
      state.accounts = [];
      state.activeAccountId = 0;
    },
    updateAccount(state: IWalletState, action: PayloadAction<IAccountUpdateState>) {
      state.accounts[action.payload.id] = {
        ...state.accounts[action.payload.id],
        ...action.payload,
      };
    },
    updateAccountAddress(state: IWalletState, action: PayloadAction<IAccountUpdateAddress>) {
      state.accounts[action.payload.id] = {
        ...state.accounts[action.payload.id],
        ...action.payload,
      };
    },
    deleteWallet(state: IWalletState) {
      state.keystores = [];
      state.accounts = [];
      state.seedKeystoreId = -1;
      state.activeAccountId = 0;
      state.encriptedMnemonic = null;
      state.activeNetwork = SYS_NETWORK.main.id;
    },
    changeAccountActiveId(state: IWalletState, action: PayloadAction<number>) {
      state.activeAccountId = action.payload;
    },
    changeActiveNetwork(state: IWalletState, action: PayloadAction<string>) {
      state.activeNetwork = action.payload;
    },
    updateTransactions(
      state: IWalletState,
      action: PayloadAction<{ id: number; txs: Transaction[] }>
    ) {
      state.accounts[action.payload.id].transactions = action.payload.txs;
    },
    updateLabel(
      state: IWalletState,
      action: PayloadAction<{ id: number; label: string }>
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
  removeAccounts,
  deleteWallet,
  updateSeedKeystoreId,
  changeAccountActiveId,
  changeActiveNetwork,
  updateAccount,
  updateTransactions,
  updateLabel,
  setEncriptedMnemonic,
  updateAccountAddress
} = WalletState.actions;

export default WalletState.reducer;
