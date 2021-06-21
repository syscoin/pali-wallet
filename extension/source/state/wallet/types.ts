import { Transaction, Assets } from '../../scripts/types';

export enum AccountType {
  Seed,
  PrivKey,
}

export interface IAccountState {
  id: number;
  label: string;
  xpub: string;
  assets: Assets[];
  address: { [assetId: string]: string };
  balance: number;
  transactions: Transaction[];
  connectedTo: any[];
  isTrezorWallet: boolean;
  trezorId?: number;
}

export interface IAccountUpdateState {
  id: number;
  balance: number;
  transactions: Transaction[];
  assets: Assets[]
}

export interface IAccountUpdateAddress {
  id: number;
  address: { [assetId: string]: string };
}

export interface IAccountUpdateXpub {
  id: number;
  xpub: string;
}

export interface Keystore {
  id: number,
  address: string,
  phrase: string
}

export default interface IWalletState {
  status: number;
  accounts: IAccountState[];
  activeAccountId: number;
  activeNetwork: string;
  encriptedMnemonic: any;
  currentSenderURL: string;
  currentURL: string;
  canConnect: boolean;
  connections: any[];
  confirmingTransaction: boolean;
  creatingAsset: boolean;
  issuingAsset: boolean;
  issuingNFT: boolean;
  updatingAsset: boolean;
  blockbookURL: string;
  transferringOwnership: boolean;
  sendingSys: boolean;
  changingNetwork: boolean;
}
