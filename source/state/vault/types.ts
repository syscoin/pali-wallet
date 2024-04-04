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

export interface IVaultState {
  accounts: { [key in KeyringAccountType]: PaliAccount }; //todo adjust and guarantee type is correct
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
  currentBlock: ethers.providers.Block;
  error: boolean;
  hasErrorOndAppEVM: boolean;
  hasEthProperty: boolean;
  isBitcoinBased: boolean;
  isDappAskingToChangeNetwork: boolean;
  isLastTxConfirmed: null | { [k: number]: boolean };
  isLoadingAssets: boolean;
  isLoadingBalances: boolean;
  isLoadingNfts: boolean;
  isLoadingTxs: boolean;
  isNetworkChanging: boolean;
  isPolling: boolean;
  isTimerEnabled: boolean;
  lastLogin: number;
  networks: INetworksVault;
  timer: number;
}

export interface INetworksVault {
  [INetworkType.Ethereum]: {
    [chainId: number]: INetwork;
  };
  [INetworkType.Syscoin]: {
    [chainId: number]: INetwork;
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
