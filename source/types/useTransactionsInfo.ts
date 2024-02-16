type TransactionVout = {
  addresses: string[];
  hex: string;
  isAddress: boolean;
  isOwn?: boolean;
  n: number;
  spent?: boolean;
  value: string;
};

type TransactionVin = {
  addresses: string[];
  isAddress: boolean;
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
  fees: string;
  hex: string;
  isCanceled?: boolean;
  txid: string;
  value: string;
  valueIn: string;
  version: number;
  vin: TransactionVin[];
  vout: TransactionVout[];
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
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  nonce: string;
  r: string;
  s: string;
  timestamp: number;
  to: string;
  transactionIndex: string;
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
  getTokenSymbol: (isErc20Tx: boolean, coinsList: any[], tx: any) => string;
  getTxStatus: (isCanceled: boolean, isConfirmed: boolean) => JSX.Element;
  getTxStatusIcons: (txLabel: string, isDetail: boolean) => JSX.Element;
  getTxType: (tx: any, isTxSent: boolean) => string;
  isShowedGroupBar: (tx: ITransactionInfoEvm, idx: number) => boolean;
  txId: string;
}
