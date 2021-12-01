import { Transaction, Assets } from 'scripts/types';

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
  xprv: any;
  xpub: string;
}

export interface Holding {
  assetGuid: string;
  balance: number;
  baseAssetID: string;
  decimals: number;
  description: string;
  NFTID: string;
  childAssetID: string;
  symbol: string;
  type: string;
}

export interface IWalletTokenState {
  accountId: number;
  accountXpub: string;
  holdings: any[];
  mintedTokens: any[];
  tokens: any;
}

export interface Connection {
  accountId: number;
  url: any;
}

export interface Tabs {
  canConnect: boolean;
  connections: Connection[];
  currentSenderURL: string;
  currentURL: string;
}

export default interface IWalletState {
  accounts: IAccountState[];
  activeAccountId: number;
  activeNetwork: string;
  changingNetwork: boolean;
  confirmingTransaction: boolean;
  creatingAsset: boolean;
  encriptedMnemonic: any;
  issuingAsset: boolean;
  issuingNFT: boolean;
  mintNFT: boolean;
  signingTransaction: boolean;
  signingPSBT: boolean;
  status: number;
  tabs: Tabs;
  transferringOwnership: boolean;
  updatingAsset: boolean;
  walletTokens: IWalletTokenState[];
  timer: number;
}
