import { SYS_NETWORK } from 'constants/index';
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  IAccountUpdateAddress,
  IAccountUpdateXpub,
  IWalletTokenState,
} from './types';
import { Transaction } from 'types/transactions';

const getHost = (url: string) => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

const initialState: IWalletState = {
  status: 0,
  accounts: [],
  activeAccountId: 0,
  activeNetwork: SYS_NETWORK.main.id,
  encriptedMnemonic: null,
  confirmingTransaction: false,
  changingNetwork: false,
  signingTransaction: false,
  signingPSBT: false,
  walletTokens: [],
  tabs: {
    currentSenderURL: '',
    currentURL: '',
    canConnect: false,
    connections: [],
  },
  timer: 5,
  currentBlockbookURL: 'https://blockbook.elint.services/',
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
  trustedApps: {
    'app.uniswap.org': 'app.uniswap.org',
    'trello.com': 'https://trello.com/b/0grd7QPC/dev',
    'twitter.com': 'https://twitter.com/home',
    'maps.google.com': 'https://maps.google.com/',
    'facebook.com': 'https://accounts.google.com/b/0/AddMailService',
    'sysmint.paliwallet.com': 'sysmint.paliwallet.com',
  },
  temporaryTransactionState: {
    executing: false,
    type: ''
  },
};

const WalletState = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    updateBlockbookURL(state: IWalletState, action: PayloadAction<string>) {
      return {
        ...state,
        currentBlockbookURL: action.payload
      };
    },
    updateNetwork(state: IWalletState, action: PayloadAction<any>) {
      return {
        ...state,
        networks: {
          ...state.networks,
          [action.payload.id]: action.payload
        },
      };
    },
    setTimer(state: IWalletState, action: PayloadAction<number>) {
      return {
        ...state,
        timer: action.payload,
      };
    },
    updateAllTokens(
      state: IWalletState,
      action: PayloadAction<IWalletTokenState>
    ) {
      const { accountId, accountXpub, tokens, holdings, mintedTokens } =
        action.payload;

      const sameAccountIndexAndDifferentXpub: number =
        state.walletTokens.findIndex((accountTokens: any) => {
          return (
            accountTokens.accountId === accountId &&
            accountTokens.accountXpub !== accountXpub
          );
        });

      if (sameAccountIndexAndDifferentXpub > -1) {
        state.walletTokens[sameAccountIndexAndDifferentXpub] = action.payload;

        return;
      }

      const index: number = state.walletTokens.findIndex(
        (accountTokens: any) => {
          return (
            accountTokens.accountId === accountId &&
            accountTokens.accountXpub === accountXpub
          );
        }
      );

      const walletTokens = state.walletTokens[index];

      if (index > -1) {
        if (walletTokens.tokens !== tokens) {
          walletTokens.tokens = tokens;
        }

        if (walletTokens.holdings !== holdings) {
          walletTokens.holdings = holdings;
        }

        if (walletTokens.mintedTokens !== mintedTokens) {
          walletTokens.mintedTokens = mintedTokens;
        }

        return;
      }

      if (
        state.walletTokens.indexOf({
          ...walletTokens,
          holdings,
          tokens,
          mintedTokens,
        }) > -1
      ) {
        return;
      }

      state.walletTokens.push(action.payload);
    },
    clearAllTransactions(state: IWalletState) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: false,
          type: ''
        }
      };
    },
    updateSwitchNetwork(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        changingNetwork: action.payload,
      };
    },
    updateCanConfirmTransaction(
      state: IWalletState,
      action: PayloadAction<boolean>
    ) {
      return {
        ...state,
        confirmingTransaction: action.payload,
      };
    },
    setTemporaryTransactionState(state: IWalletState, action: PayloadAction<{ executing: boolean, type: string }>) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: action.payload.executing,
          type: action.payload.type
        },
      };
    },
    removeConnection(state: IWalletState, action: PayloadAction<any>) {
      const connectionIndex: number = state.tabs.connections.findIndex(
        (connection: any) => connection.url === action.payload.url
      );

      const account = state.accounts.find(
        (element: IAccountState) => element.id === action.payload.accountId
      );

      if (connectionIndex === -1) {
        return;
      }

      state.tabs.connections.splice(connectionIndex, 1);

      account?.connectedTo.splice(
        account?.connectedTo.indexOf(action.payload.url),
        1
      );
    },
    updateConnectionsArray(
      state: IWalletState,
      action: PayloadAction<{ accountId: number, url: string }>
    ) {
      const { accounts, tabs } = state;
      const { accountId, url } = action.payload;

      const accountIndex = tabs.connections.findIndex((connection: any) => {
        return connection.accountId === accountId; 
      });

      const currentAccountIndex = accounts.findIndex((account: IAccountState) => {
        return account.id === accountId;
      })

      const urlIndex = tabs.connections.findIndex((connection: any) => {
        return connection.url === getHost(url);
      });

      if (tabs.connections[urlIndex]) {
        const accountIdConnected = accounts.findIndex((account: IAccountState) => {
          return account.id === tabs.connections[urlIndex].accountId;
        });

        if (accountIdConnected > -1) {
          const connectedToIndex = accounts[accountIdConnected].connectedTo.findIndex((connectedURL: string) => {
            return connectedURL === getHost(url);
          });
  
          if (connectedToIndex > -1) {
            accounts[accountIdConnected].connectedTo.splice(connectedToIndex, 1);

            tabs.connections[urlIndex] = {
              ...tabs.connections[urlIndex],
              accountId,
            }

            accounts[currentAccountIndex].connectedTo.push(getHost(url));
          }
        }

        return;
      }

      if (tabs.connections[accountIndex]) {
        if (tabs.connections[accountIndex].url === getHost(url)) {
          return;
        }

        tabs.connections.push({
          accountId,
          url: getHost(url)
        });

        accounts[currentAccountIndex].connectedTo.push(getHost(url));

        return;
      }

      tabs.connections.push({
        accountId,
        url: getHost(url),
      });

      accounts[currentAccountIndex].connectedTo.push(getHost(url));
    },
    updateCanConnect(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          canConnect: action.payload
        },
      };
    },
    updateCurrentURL(state: IWalletState, action: PayloadAction<string>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          currentURL: action.payload
        }
      };
    },
    setSenderURL(state: IWalletState, action: PayloadAction<string>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          currentSenderURL: action.payload
        },
      };
    },
    setEncriptedMnemonic(
      state: IWalletState,
      action: PayloadAction<CryptoJS.lib.CipherParams>
    ) {
      state.encriptedMnemonic = action.payload.toString();
    },
    updateStatus(state: IWalletState) {
      state.status = Date.now();
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

      const connectionIndex = state.tabs.connections.findIndex(
        (element: any) => element.accountId === action.payload
      );

      state.walletTokens.splice(infoIndex, 1);
      state.tabs.connections.splice(connectionIndex, 1);
      state.accounts.splice(accountIndex, 1);
    },

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
      state.accounts[action.payload.id] = {
        ...state.accounts[action.payload.id],
        ...action.payload,
      };
    },
    deleteWallet(state: IWalletState) {
      state.accounts = [];
      state.activeAccountId = 0;
      state.encriptedMnemonic = null;
      state.activeNetwork = SYS_NETWORK.main.id;
      state.status = 0;
      state.tabs = {
        currentSenderURL: '',
        currentURL: '',
        canConnect: false,
        connections: []
      };
      state.confirmingTransaction = false;
      state.signingPSBT = false;
      state.changingNetwork = false;
      state.signingTransaction = false;
      state.walletTokens = [];
    },
    changeAccountActiveId(state: IWalletState, action: PayloadAction<number>) {
      state.activeAccountId = action.payload;
    },
    changeActiveNetwork(state: IWalletState, action: PayloadAction<any>) {
      state.activeNetwork = action.payload.id;
      state.currentBlockbookURL = action.payload.beUrl;
    },
    updateTransactions(
      state: IWalletState,
      action: PayloadAction<{ id: number, txs: Transaction[] }>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      state.accounts[indexOf].transactions = action.payload.txs;
    },
    updateLabel(
      state: IWalletState,
      action: PayloadAction<{ id: number, label: string }>
    ) {
      const indexOf = state.accounts.findIndex(
        (element: IAccountState) => element.id === action.payload.id
      );

      state.accounts[indexOf].label = action.payload.label;
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
  updateAccountXpub,
  setSenderURL,
  updateCurrentURL,
  updateCanConnect,
  updateConnectionsArray,
  removeConnection,
  updateCanConfirmTransaction,
  updateSwitchNetwork,
  clearAllTransactions,
  updateAllTokens,
  setTimer,
  updateNetwork,
  setTemporaryTransactionState
} = WalletState.actions;

export default WalletState.reducer;
