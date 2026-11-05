import type { ITransactionInfoUtxo } from './utxoTransaction';
export type {
  IAssetInfo,
  ITransactionInfoUtxo,
  ITransactionVin,
  ITransactionVout,
} from './utxoTransaction';

type valuePending = {
  hex: string;
  type: string;
};

export interface ITransactionInfoEvm {
  accessList: any[];
  blockHash: string;
  blockNumber: string;
  chainId: number;
  confirmations: number;
  from: string;
  gas: string;
  gasPrice: string;
  hash: string;
  input: string;
  isCanceled?: boolean;
  isError?: string | null;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  nonce: string;
  r: string;
  s: string;
  timestamp: number;
  to: string;
  transactionIndex: string;
  // Transaction status fields
  txreceipt_status?: string | null;
  type: string;
  v: string;
  value: string | valuePending;
}

export type modalDataType = {
  buttonText: string;
  description: string;
  isButtonLoading?: boolean;
  onClick: () => void;
  onClose: () => void;
  title: string;
};
export interface ITransactionsListConfig {
  blocktime: string;
  filteredTransactions: ITransactionInfoEvm[] | ITransactionInfoUtxo[];
  formatTimeStamp: (timestamp: number) => string;
  formatTimeStampUtxo: (timestamp: number) => JSX.Element;
  getTxStatus: (isCanceled: boolean, isConfirmed: boolean) => JSX.Element;
  getTxStatusIcons: (txLabel: string, isDetail: boolean) => JSX.Element;
  getTxType: (tx: any, isTxSent: boolean) => string;
  txId: string;
}
