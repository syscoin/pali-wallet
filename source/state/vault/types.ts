import { IAccountState } from 'state/wallet/types';

export enum AssetType {
  Ethereum = 'ethereum',
  Syscoin = 'syscoin',
}

export default interface IVaultState {
  accounts: IAccountState[];
  activeAccount: IAccountState;
  balances: any;
  hasEncryptedVault: boolean;
  lastLogin: number;
  migrateWallet?: any;
  networks: any;
  temporaryTransactionState: {
    executing: boolean;
    type: string;
  };
  timer: number;
  version: string;
}
