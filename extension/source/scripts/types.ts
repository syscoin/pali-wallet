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
  token: Assets | null;
  isToken: boolean;
  rbf: boolean;
}

export interface ISPTInfo {
  precision: number,
  symbol: string,
  maxsupply: number,
  fee: number,
  description: string,
  receiver: string,
  rbf: number
}

export type PendingTx = {
  txid: string;
  value: number;
  confirmations: number;
  fees: number;
  blockTime: number;
}