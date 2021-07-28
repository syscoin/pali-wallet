import { Transaction, Assets } from '../../scripts/types';

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
  assets: Assets[],
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
  xprv: string;
  xpub: string;
}

export interface Holding {
  balance: number;
  type: string;
  decimals: number;
  symbol: string;
  assetGuid: string;
  baseAssetID: string;
  nftAssetID: string;
  description: string;
}

export interface IWalletTokenState {
  accountId: number;
  accountXpub: string;
  holdings: Holding[];
  tokens: any;
}

export interface Connection {
  accountId: number;
  url: string;
}

export interface Tabs {
  currentSenderURL: string;
  currentURL: string;
  canConnect: boolean;
  connections: Connection[];
}

export default interface IWalletState {
  accounts: IAccountState[];
  activeAccountId: number;
  activeNetwork: string;
  canConnect: boolean;
  changingNetwork: boolean;
  confirmingTransaction: boolean;
  connections: any[];
  creatingAsset: boolean;
  currentSenderURL: string;
  currentURL: string;
  encriptedMnemonic: any;
  issuingAsset: boolean;
  issuingNFT: boolean;
  status: number;
  transferringOwnership: boolean;
  updatingAsset: boolean;
  signingTransaction: boolean;
  walletTokens: IWalletTokenState[];
  tabs: Tabs;
}
