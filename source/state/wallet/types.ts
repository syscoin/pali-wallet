import { Transaction, Assets } from 'types/transactions';

export interface IAccountState {
  address: { [assetId: string]: string };
  assets: Assets[];
  balance: number;
  connectedTo: any[];
  id: number;
  isTrezorWallet: boolean;
  label: string;
  transactions: Transaction[];
  trezorId?: number;
  xprv: string;
  xpub: string;
}

export interface IAccountUpdateState {
  assets: Assets[];
  balance: number;
  id: number;
  transactions: Transaction[];
}

export interface IAccountUpdateAddress {
  address: { [assetId: string]: string };
  id: number;
}

export interface IAccountUpdateXpub {
  id: number;
  xprv: any;
  xpub: string;
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
  tokens: { [assetGuid: string]: Assets };
}

export interface INetwork {
  beUrl: string;
  id: string;
  label: string;
}

export default interface IWalletState {
  accounts: IAccountState[];
  activeAccountId: number;
  walletTokens: IWalletTokenState[];
}
