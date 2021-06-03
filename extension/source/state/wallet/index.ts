import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from '../../scripts/types';

import { SYS_NETWORK } from 'constants/index';
import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  IAccountUpdateAddress
} from './types';

const initialState: IWalletState = {
  status: 0,
  accounts: [],
  activeAccountId: 0,
  activeNetwork: SYS_NETWORK.main.id,
  encriptedMnemonic: null,
  currentSenderURL: '',
  currentURL: '',
  canConnect: false,
  connections: [],
  confirmingTransaction: false,
  creatingAsset: false,
  issuingAsset: false,
  issuingNFT: false
};

const WalletState = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    updateCanConfirmTransaction(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        confirmingTransaction: action.payload,
      }
    },
    createAsset(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        creatingAsset: action.payload,
      }
    },
    issueAsset(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        issuingAsset: action.payload,
      }
    },
    issueNFT(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        issuingNFT: action.payload,
      }
    },
    removeConnection(state: IWalletState, action: PayloadAction<any>) {
      const connectionIndex: number = state.connections.findIndex(connection => connection.url === action.payload.url);

      if (connectionIndex === -1) {
        return;
      }

      state.connections.splice(connectionIndex, 1);

      state.accounts[action.payload.accountId].connectedTo.splice(state.accounts[action.payload.accountId].connectedTo.indexOf(action.payload.url), 1);
    },
    updateConnectionsArray(state: IWalletState, action: PayloadAction<any>) {
      const index: number = state.connections.findIndex(connection => connection.accountId !== action.payload.accountId && connection.url === action.payload.url);

      if (state.connections[index]) {
        state.accounts[state.connections[index].accountId].connectedTo.splice(state.connections.findIndex(url => url == state.connections[index].url), 1);

        state.connections[index] = action.payload;

        state.accounts[state.connections[index].accountId].connectedTo.push(state.connections[index].url);

        return;
      }

      const alreadyExistsIndex: number = state.connections.findIndex(connection => connection.accountId == action.payload.accountId && connection.url === action.payload.url);

      if (state.connections[alreadyExistsIndex]) {
        state.connections[alreadyExistsIndex] = action.payload;
        state.accounts[alreadyExistsIndex].connectedTo[alreadyExistsIndex] = action.payload.url;

        return;
      }

      state.connections.push(action.payload);

      state.accounts[action.payload.accountId].connectedTo.push(action.payload.url);
    },
    updateCanConnect(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        canConnect: action.payload,
      }
    },
    updateCurrentURL(state: IWalletState, action: PayloadAction<string | undefined>) {
      return {
        ...state,
        currentURL: action.payload,
      }
    },
    setSenderURL(state: IWalletState, action: PayloadAction<string | undefined>) {
      return {
        ...state,
        currentSenderURL: action.payload
      }
    },
    setEncriptedMnemonic(state: IWalletState, action: PayloadAction<CryptoJS.lib.CipherParams>) {
      state.encriptedMnemonic = action.payload.toString();
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
      // state.activeAccountId = 0;
    },

    removeAccounts(state: IWalletState) {
      state.accounts = [];
      state.activeAccountId = 0;
    },
    updateAccount(state: IWalletState, action: PayloadAction<IAccountUpdateState>) {
      let indexof = state.accounts.findIndex((element: IAccountState) => element.id == action.payload.id)
      state.accounts[indexof] = {
        ...state.accounts[indexof],
        ...action.payload,
      };
    },
    updateAccountAddress(state: IWalletState, action: PayloadAction<IAccountUpdateAddress>) {
      let indexof = state.accounts.findIndex((element: IAccountState) => element.id == action.payload.id)
      console.log(indexof)
      state.accounts[indexof] = {
        ...state.accounts[indexof],
        ...action.payload,
      };
    },
    deleteWallet(state: IWalletState) {
      state.accounts = [];
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
      let indexof = state.accounts.findIndex((element: IAccountState) => element.id == action.payload.id)
      state.accounts[indexof].transactions = action.payload.txs;
    },
    updateLabel(
      state: IWalletState,
      action: PayloadAction<{ id: number; label: string }>
    ) {
      let indexof = state.accounts.findIndex((element: IAccountState) => element.id == action.payload.id)
      state.accounts[indexof].label = action.payload.label;
    },
  },
});

export const {
  updateStatus,
  createAccount,
  removeAccount,
  removeAccounts,
  deleteWallet,
  changeAccountActiveId,
  changeActiveNetwork,
  updateAccount,
  updateTransactions,
  updateLabel,
  setEncriptedMnemonic,
  updateAccountAddress,
  setSenderURL,
  updateCurrentURL,
  updateCanConnect,
  updateConnectionsArray,
  removeConnection,
  updateCanConfirmTransaction,
  createAsset,
  issueAsset,
  issueNFT
} = WalletState.actions;

export default WalletState.reducer;
