import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { IAccountState } from 'state/wallet/types';
import { Transaction } from 'types/transactions';

import IVaultState, { AssetType } from './types';

// ! modified for testing only !
// const hasEncryptedVault = !!localStorage.getItem('paliwallet-vault');
const hasEncryptedVault = false;

export const initialState: IVaultState = {
  lastLogin: 0,
  accounts: [],
  activeAccount: {
    web3PrivateKey: '',
    web3Address: '',
    address: {
      main: '',
    },
    assets: [],
    balance: 0,
    connectedTo: [],
    id: -1,
    isTrezorWallet: false,
    label: 'Account 1',
    transactions: [],
    trezorId: -1,
    xprv: '',
    xpub: '',
  },
  networks: {
    syscoin: {
      main: {
        id: 'main',
        label: 'Syscoin Mainnet',
        beUrl: 'https://blockbook.elint.services/',
      },
      testnet: {
        id: 'testnet',
        label: 'Syscoin Testnet',
        beUrl: 'https://blockbook-dev.elint.services/',
      },
    },
    ethereum: {
      kovan: {
        id: 'kovan',
        label: 'Kovan',
        beUrl: 'https://blockbook-dev.elint.services/',
      },
    },
  },
  balances: {
    [AssetType.Syscoin]: 0,
    [AssetType.Ethereum]: 0,
  },
  hasEncryptedVault,
  version: '2.0.0',
  timer: 5,
  temporaryTransactionState: {
    executing: false,
    type: '',
  },
};

// createSlice comes with immer produce so we don't need to take care of immutational update
const VaultState = createSlice({
  name: 'vault',
  initialState,
  reducers: {
    // set wallet accounts according to network
    setVaultInfo(state: IVaultState, action: PayloadAction<any>) {
      state.accounts = action.payload.accounts;
    },
    // In minutes
    setTimer(state: IVaultState, action: PayloadAction<number>) {
      return {
        ...state,
        timer: action.payload,
      };
    },
    // update login status
    updateStatus(state: IVaultState) {
      state.lastLogin = Date.now();
    },
    changeActiveAccount(
      state: IVaultState,
      action: PayloadAction<IAccountState>
    ) {
      state.activeAccount = action.payload;
    },
    changeActiveNetwork(
      state: IVaultState,
      action: PayloadAction<{ chainId: string; network: any }>
    ) {
      state.networks = {
        ...state.networks,
        [action.payload.chainId]: action.payload,
      };
    },
    // set active account assets according to network
    updateWalletAssets(state: IVaultState, action: PayloadAction<any[]>) {
      state.activeAccount.assets = action.payload;
    },
    // update account label when editing account
    updateWalletLabel(state: IVaultState, action: PayloadAction<string>) {
      state.activeAccount.label = action.payload;
    },
    updateTransactions(
      state: IVaultState,
      action: PayloadAction<{ txs: Transaction[] }>
    ) {
      state.activeAccount.transactions = action.payload.txs;
    },
    updateBalances(state: IVaultState, action: PayloadAction<any>) {
      state.balances = action.payload;
    },
    migrateWalletComplete(state: IVaultState) {
      delete state.migrateWallet;
    },
    setTemporaryTransactionState(
      state: IVaultState,
      action: PayloadAction<{ executing: boolean; type: string }>
    ) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: action.payload.executing,
          type: action.payload.type,
        },
      };
    },
  },
});

export const {
  setVaultInfo,
  updateStatus,
  changeActiveAccount,
  changeActiveNetwork,
  updateWalletAssets,
  updateWalletLabel,
  updateTransactions,
  updateBalances,
  migrateWalletComplete,
  setTimer,
  setTemporaryTransactionState,
} = VaultState.actions;

export default VaultState.reducer;
