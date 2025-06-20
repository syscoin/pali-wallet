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

export interface IVaultState {
  // New: Separate global asset storage
  accountAssets: {
    [key in KeyringAccountType]: { [id: number]: IAccountAssets };
  };

  // New: Separate global transaction storage
  accountTransactions: {
    [key in KeyringAccountType]: { [id: number]: IAccountTransactions };
  };

  // Updated: Clean accounts - just references to keyring data
  accounts: {
    [key in KeyringAccountType]: { [id: number]: IKeyringAccountState };
  };

  activeAccount: {
    id: number;
    type: KeyringAccountType;
  };
  activeChain: INetworkType;
  activeNetwork: INetwork;
  advancedSettings: {
    [k: string]: boolean;
  };
  changingConnectedAccount: IChangingConnectedAccount;
  coinsList: any[];
  error: string | null;
  hasEncryptedVault: boolean;
  hasErrorOndAppEVM: boolean;
  hasEthProperty: boolean;
  isBitcoinBased: boolean;
  isDappAskingToChangeNetwork: boolean;
  isLastTxConfirmed: null | { [k: number]: boolean };
  isLoadingAssets: boolean;
  isLoadingBalances: boolean;
  isLoadingNfts: boolean;
  isLoadingTxs: boolean;
  isSwitchingAccount: boolean;
  lastLogin: number;
  networkStatus: 'idle' | 'switching' | 'error';
  networkTarget?: INetwork;
  networks: INetworksVault;
  prevBalances: IPrevBalances;
  shouldShowFaucetModal: { [k: number]: boolean };
}

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
