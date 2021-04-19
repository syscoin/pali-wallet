import { Transaction, Assets } from '../../scripts/types';

export enum AccountType {
  Seed,
  PrivKey,
}

export interface IAccountState {
  id: number;
  label: string;
  xpub: string;
  masterPrv: string;
  assets: Assets[];
  address: { [assetId: string]: string };
  // type: AccountType;
  balance: number;
  transactions: Transaction[];
  accountIsConnected: boolean;
  connectedTo: string | undefined;
}

export interface IAccountUpdateState {
  id: number;
  balance: number;
  transactions: Transaction[];
}

export interface IAccountUpdateConnection {
  id: number;
  accountIsConnected: boolean;
  connectedTo: string | undefined;
}

export interface IAccountUpdateAddress {
  id: number;
  address: { [assetId: string]: string };
}

export interface Keystore {
  id: number,
  address: string,
  phrase: string
}

export default interface IWalletState {
  keystores: Keystore[];
  status: number;
  accounts: IAccountState[];
  activeAccountId: number;
  seedKeystoreId: number;
  activeNetwork: string;
  encriptedMnemonic: any;
  isConnected: boolean;
  connectedTo: string | undefined;
  currentURL: string | undefined;
  connectedAccountId: number;
  canConnect: boolean;
}
