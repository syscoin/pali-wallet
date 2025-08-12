export type IAssetInfo = {
  assetGuid: string;
  value?: number | string;
  valueStr?: string;
};

export type ITransactionVout = {
  addresses: string[];
  // Optional enriched fields from Blockbook for SPT context
  assetInfo?: IAssetInfo;
  hex: string;
  isAddress: boolean;
  isOwn?: boolean;
  n: number;
  spent?: boolean;
  value: string;
};

export type ITransactionVin = {
  addresses: string[];
  // Optional enriched fields from Blockbook for SPT context
  assetInfo?: IAssetInfo;
  isAddress: boolean;
  isOwn?: boolean;
  n: number;
  sequence: number;
  txid: string;
  value: string;
};

export interface ITransactionInfoUtxo {
  blockHash: string;
  blockHeight: number;
  blockTime: number;
  confirmations: number;
  // Array of token transfer details
  direction?: 'sent' | 'received';
  fees: string;
  hex: string;
  // SPT transaction type (e.g., 'SPTAssetAllocationBurnToSyscoin')
  tokenTransfers?: any[];
  tokenType?: string;
  txid: string;
  value: string;
  valueIn: string;
  version: number;
  vin: ITransactionVin[];
  vout: ITransactionVout[]; // Transaction direction relative to current account
}

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
