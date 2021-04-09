import { Transaction } from '../../scripts/types';

export enum AccountType {
  Seed,
  PrivKey,
}

export interface IAccountState {
  id: number;
  label: string;
  xpub: string;
  masterPrv: string;
  assets: {
    [assetId: number]: {
      name: string;
      balance: number;
    };
  };
  address: { [assetId: string]: string };
  // type: AccountType;
  balance: number;
  transactions: Transaction[];
}

export interface IAccountUpdateState {
  id: number;
  balance: number;
  transactions: Transaction[];
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
  accountConnected: number;
  canConnect: boolean;
}
