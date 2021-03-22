import { Transaction } from '@stardust-collective/dag4-network';
export interface IAccountInfo {
  address: {
    [assetId: string]: string;
  };
  balance: number;
  transactions: Transaction[];
}

export interface ITransactionInfo {
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number | undefined;
}
