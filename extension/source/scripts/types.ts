export type Transaction = {
  txid: string;
  value: number;
  confirmations: number;
  fees: number;
  blockTime: number;
  tokenType: string;
}

export type Assets = {
  type: string;
  assetGuid: number;
  symbol: string;
  balance: number;
  decimals: number
}

export interface IAccountInfo {
  balance: number;
  assets: Assets[];
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