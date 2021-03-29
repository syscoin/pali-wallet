import { Transaction } from '../../scripts/types';

export enum AccountType {
  Seed,
  PrivKey,
}

export interface IAccountState {
  id: number;
  label: string;
  address: {
    [assetId: string]: string;
  };
  balance: number;
  type: AccountType;
  transactions: Transaction[];
}

export interface IAccountUpdateState {
  id: number;
  balance: number;
  transactions: Transaction[];
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
  index: number;
}
