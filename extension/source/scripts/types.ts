export type Transaction = {
  txid: string;
  value: number;
  confirmations: number;
  fees: number;
  blockTime: number;
  tokenType: string;
}

export interface IAccountInfo {
  balance: number;
  assets: {
    [assetId: number]: {
      name: string;
      balance: number;
    };
  };
  transactions: Transaction[];
}

export interface ITransactionInfo {
  fromAddress: string;
  toAddress: string;
  amount: number;
  fee: number;
}

export type PendingTx = {
  txid: string;
  value: number;
  confirmations: number;
  fees: number;
  blockTime: number;
}