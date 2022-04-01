import { IWalletState } from '@pollum-io/sysweb3-utils';

export interface IVaultState extends IWalletState {
  activeToken: string;
  isPendingBalances: boolean;
  timer: number;
  trustedApps: string[];
  encryptedMnemonic: string;
  lastLogin: number;
}

export interface Holding {
  NFTID: string;
  assetGuid: string;
  balance: number;
  baseAssetID: string;
  childAssetID: string;
  decimals: number;
  description: string;
  symbol: string;
  type: string;
}

export interface IMintedToken {
  assetGuid: string;
  maxSupply: number;
  symbol: string;
  totalSupply: number;
}

export interface IWalletTokenState {
  accountId: number;
  accountXpub: string;
  holdings: any[]; // ? Holding[]
  mintedTokens: IMintedToken[];
  tokens: any;
}

export interface INetwork {
  beUrl: string;
  id: string;
  label: string;
}
