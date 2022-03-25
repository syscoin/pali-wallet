import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { Transaction } from 'types/transactions';

import IWalletState, {
  IAccountUpdateState,
  IAccountState,
  IAccountUpdateAddress,
  IAccountUpdateXpub,
  IWalletTokenState,
  Connection,
  INetwork,
} from './types';

const getHost = (url: string) => {
  if (typeof url === 'string' && url !== '') {
    return new URL(url).host;
  }

  return url;
};

export const initialState: IWalletState = {
  status: 0,
  accounts: [],
  activeAccountId: 0,
  activeNetwork: 'main',
  activeChainId: 57,
  activeNetworkType: 'syscoin',
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
  currentBlockbookURL: 'https://blockbook.elint.services/',
  networks: {
    syscoin: {
      main: {
        id: 'main',
        chainId: 57,
        label: 'Main Network',
        beUrl: 'https://blockbook.elint.services/',
        type: 'syscoin',
      },
      testnet: {
        id: 'testnet',
        chainId: 5700,
        label: 'Test Network',
        beUrl: 'https://blockbook-dev.elint.services/',
        type: 'syscoin',
      },
    },
    polygon: {
      mainnet: {
        id: 'mainnet',
        chainId: 137,
        label: 'Mainnet',
        beUrl: '',
        type: 'polygon',
      },
      testnet: {
        id: 'testnet',
        chainId: 80001,
        label: 'Testnet',
        beUrl: '',
        type: 'polygon',
      },
    },
    web3: {
      mainnet: {
        id: 'mainnet',
        chainId: 1,
        label: 'Mainnet',
        beUrl: '',
        type: 'web3',
      },
      rinkeby: {
        id: 'rinkeby',
        chainId: 4,
        label: 'Rinkeby',
        beUrl: '',
        type: 'web3',
      },
    },
    kovan: {
      id: 'kovan',
      label: 'Kovan Test',
      beUrl: 'https://kovan.etherscan.io/',
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
  temporaryTransactionState: { executing: false, type: '' },
  timer: 5,
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
    // In minutes
    setTimer(state: IWalletState, action: PayloadAction<number>) {
      return {
        ...state,
        timer: action.payload,
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
    clearAllTransactions(state: IWalletState) {
      return {
        ...state,
        temporaryTransactionState: {
          executing: false,
          type: '',
        },
      };
    },
    updateSwitchNetwork(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        changingNetwork: action.payload,
      };
    },
    // TODO: create handle for 2 types of send asset (site and extension)
    // and remove calls for confirmingtransaction
    updateCanConfirmTransaction(
      state: IWalletState,
      action: PayloadAction<boolean>
    ) {
      return {
        ...state,
        confirmingTransaction: action.payload,
      };
    },
    setTemporaryTransactionState(
      state: IWalletState,
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
    // remove the connection from [state.tabs.connections]
    // and its url from [state.accounts[id].connectedTo]
    removeConnection(state: IWalletState, action: PayloadAction<Connection>) {
      const connectionIndex: number = state.tabs.connections.findIndex(
        (connection: Connection) => connection.url === action.payload.url
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
    // removes connection with the provided url (if existent)
    // and create a connection
    updateConnectionsArray(
      state: IWalletState,
      action: PayloadAction<Connection>
    ) {
      const { accountId, url } = action.payload;

      const { accounts, tabs } = state;
      const { connections } = tabs;

      // if the connection already exists
      if (connections.includes(action.payload)) return;

      const accountIndex = accounts.findIndex(
        (account: IAccountState) => account.id === accountId
      );

      const connectionIndex = connections.findIndex(
        (connection: any) => connection.url === getHost(url)
      );

      // if there is a connection with the payload.url
      if (connections[connectionIndex]) {
        // find the connected account
        const connectedAccountIndex = accounts.findIndex(
          (account: IAccountState) =>
            account.id === connections[connectionIndex].accountId
        );

        // if found the connected account
        if (connectedAccountIndex > -1) {
          // find the index of the connection (account side)
          const connectedToIndex = accounts[
            connectedAccountIndex
          ].connectedTo.findIndex(
            (connectedURL: string) => connectedURL === getHost(url)
          );

          // if found the connection
          if (connectedToIndex > -1) {
            // remove the connection (account side)
            accounts[connectedAccountIndex].connectedTo.splice(
              connectedToIndex,
              1
            );

            // update the accountId (connection side)
            connections[connectionIndex] = {
              ...connections[connectionIndex],
              accountId,
            };

            // add connection (account side)
            accounts[accountIndex].connectedTo.push(getHost(url));
          }
        }

        return;
      }

      // add the connection (connection side)
      connections.push({
        accountId,
        url: getHost(url),
      });

      // add the connection (account side)
      accounts[accountIndex].connectedTo.push(getHost(url));
    },
    // TODO: refactor and use to use an easier way to know if the wallet can connect (provider)
    updateCanConnect(state: IWalletState, action: PayloadAction<boolean>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          canConnect: action.payload,
        },
      };
    },
    updateCurrentURL(state: IWalletState, action: PayloadAction<string>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          currentURL: action.payload,
        },
      };
    },
    setSenderURL(state: IWalletState, action: PayloadAction<string>) {
      return {
        ...state,
        tabs: {
          ...state.tabs,
          currentSenderURL: action.payload,
        },
      };
    },
    setEncriptedMnemonic(
      state: IWalletState,
      action: PayloadAction<CryptoJS.lib.CipherParams>
    ) {
      state.encriptedMnemonic = action.payload.toString();
    },
    setWeb3Address(state: IWalletState, action: PayloadAction<string>) {
      if (state.activeAccountId) {
        state.accounts[state.activeAccountId].web3Address = action.payload;
      }
    },
    setWeb3PrivateKey(state: IWalletState, action: PayloadAction<string>) {
      if (state.activeAccountId) {
        state.accounts[state.activeAccountId].web3PrivateKey = action.payload;
      }
    },
    // TODO rename [status] to something more meaningful
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
    deleteWallet() {
      return initialState;
    },
    changeAccountActiveId(state: IWalletState, action: PayloadAction<number>) {
      state.activeAccountId = action.payload;
    },
    changeActiveNetwork(state: IWalletState, action: PayloadAction<INetwork>) {
      state.activeChainId = action.payload.chainId;
      state.activeNetworkType = action.payload.type;
      state.activeNetwork = action.payload.label;
      state.currentBlockbookURL = action.payload.beUrl;
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
  setWeb3Address,
  setWeb3PrivateKey,
  updateNetwork,
} = WalletState.actions;

export default WalletState.reducer;
