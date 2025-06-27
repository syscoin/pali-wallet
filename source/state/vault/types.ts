import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetwork, INetworkType } from '@pollum-io/sysweb3-network';
import { INftsStructure } from '@pollum-io/sysweb3-utils';

import {
  IEvmTransaction,
  ISysTransaction,
} from 'scripts/Background/controllers/transactions/types';
import { ITokenEthProps, ITokenSysProps } from 'types/tokens';

// Clean account assets structure
export interface IAccountAssets {
  ethereum: ITokenEthProps[];
  nfts: INftsStructure[];
  syscoin: ITokenSysProps[];
}

// Clean account transactions structure
export interface IAccountTransactions {
  ethereum: { [chainId: number]: IEvmTransaction[] };
  syscoin: { [chainId: number]: ISysTransaction[] };
}

// Loading states interface for transient UI states
export interface ILoadingStates {
  isLoadingAssets: boolean;
  isLoadingBalances: boolean;
  isLoadingNfts: boolean;
  isLoadingTxs: boolean;
}

// Global state shared across all slip44s (stored in main state)
export interface IGlobalState {
  // Current active slip44 - single source of truth
  activeSlip44: number | null;

  // User preferences - should be shared across all networks
  advancedSettings: {
    [k: string]: boolean | number; // Allow both boolean and number values
  };

  changingConnectedAccount: IChangingConnectedAccount;
  // Global data that doesn't vary by slip44
  coinsList: any[];
  // Global UI states
  error: string | null;

  hasEncryptedVault: boolean;

  hasEthProperty: boolean;
  isDappAskingToChangeNetwork: boolean;
  // Track if current updates are from polling (background) vs user action
  isPollingUpdate: boolean;
  isSwitchingAccount: boolean;
  // Authentication & security
  lastLogin: number;
  // Transient loading states - never persisted across app restarts
  loadingStates: ILoadingStates;

  // Network quality tracking
  networkQuality?: {
    hasCriticalErrors?: boolean;
    hasSlowOperations?: boolean;
    lastBalanceLatency?: number; // For timeouts/failures
    timestamp?: number;
  };

  networkStatus: 'idle' | 'switching' | 'error' | 'connecting';

  networkTarget?: INetwork;

  // Global networks - shared across all vaults
  networks: INetworksVault;
}

// Slip44-specific state (per network type) - this is what IVaultState represents
export interface ISlip44State {
  accountAssets: {
    [key in KeyringAccountType]: { [id: number]: IAccountAssets };
  };

  accountTransactions: {
    [key in KeyringAccountType]: { [id: number]: IAccountTransactions };
  };

  // Network-specific data
  accounts: {
    [key in KeyringAccountType]: { [id: number]: IKeyringAccountState };
  };

  activeAccount: {
    id: number;
    type: KeyringAccountType;
  };

  activeChain: INetworkType;
  activeNetwork: INetwork;
  // Network-specific states
  isBitcoinBased: boolean;

  isLastTxConfirmed: null | { [k: number]: boolean };
  prevBalances: IPrevBalances;

  shouldShowFaucetModal: { [k: number]: boolean };
}

// For backward compatibility, IVaultState is the slip44-specific state
// Components can access global state via state.vaultGlobal
export type IVaultState = ISlip44State;

export interface INetworksVault {
  [INetworkType.Ethereum]: {
    [chainId: number]: INetwork;
  };
  [INetworkType.Syscoin]: {
    [chainId: number]: INetwork;
  };
}

export interface IPrevBalances {
  [accountId: number]: {
    [INetworkType.Ethereum]: {
      [chainId: number]: number;
    };
    [INetworkType.Syscoin]: {
      [chainId: number]: number;
    };
  };
}

export interface IChangingConnectedAccount {
  connectedAccountType: KeyringAccountType | undefined;
  host: string | undefined;
  isChangingConnectedAccount: boolean;
  newConnectedAccount: IKeyringAccountState | undefined;
}

// eslint-disable-next-line no-shadow
export enum TransactionsType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}

// Removed: IPaliAccount and related types - use separated structures instead
export type IOmmitedAccount = Omit<IKeyringAccountState, 'xprv'>;

export type IOmittedVault = Omit<IVaultState, 'accounts'> & {
  accounts: { [id: number]: IOmmitedAccount };
};
