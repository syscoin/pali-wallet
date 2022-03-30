import { Transaction, Assets } from 'types/transactions';

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
  tokens: { [assetGuid: string]: Assets };
}

export interface INetwork {
  beUrl: string;
  id: string;
  label: string;
}
