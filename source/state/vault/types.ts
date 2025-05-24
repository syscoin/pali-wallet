import { ethers } from 'ethers';

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

// Extend INetwork with kind field for type safety
export interface INetworkWithKind extends INetwork {
  kind: 'evm' | 'utxo';
}

export interface IVaultState {
  accounts: { [key in KeyringAccountType]: PaliAccount };
  activeAccount: {
    id: number;
    type: KeyringAccountType;
  };
  activeChain: INetworkType;
  activeNetwork: INetworkWithKind;
  advancedSettings: {
    [k: string]: boolean;
  };
  changingConnectedAccount: IChangingConnectedAccount;
  coinsList: any[];
  currentBlock: ethers.providers.Block;
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
  isPolling: boolean;
  isSwitchingAccount: boolean;
  lastLogin: number;
  networkStatus: 'idle' | 'switching' | 'error';
  networkTarget?: INetworkWithKind;
  networks: INetworksVault;
  prevBalances: IPrevBalances;
  shouldShowFaucetModal: { [k: number]: boolean };
}

export interface INetworksVault {
  [INetworkType.Ethereum]: {
    [chainId: number]: INetworkWithKind;
  };
  [INetworkType.Syscoin]: {
    [chainId: number]: INetworkWithKind;
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

export interface IPaliAccount extends IKeyringAccountState {
  assets: {
    ethereum: ITokenEthProps[];
    nfts: INftsStructure[];
    syscoin: ITokenSysProps[];
  };
  transactions: TransactionsNetworkTypeMapping;
}
export type PaliAccount = {
  [id: number]: IPaliAccount;
};

// eslint-disable-next-line no-shadow
export enum TransactionsType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}

export type TransactionsNetworkTypeMapping = {
  [key in TransactionsType]: IChainNumberTransactions;
};

export interface IChainNumberTransactions {
  [chainId: number]: IEvmTransaction[] | ISysTransaction[];
}

export type IOmmitedAccount = Omit<IPaliAccount, 'xprv'>;

export type IOmittedVault = Omit<IVaultState, 'accounts'> & {
  accounts: { [id: number]: IOmmitedAccount };
};
