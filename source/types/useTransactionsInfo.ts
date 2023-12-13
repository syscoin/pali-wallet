export interface ITransactionInfo {
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
  value: string;
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
  filteredTransactions: ITransactionInfo[];
  formatTimeStamp: (timestamp: number) => string;
  getTxOptions: (
    isCanceled: boolean,
    isConfirmed: boolean,
    tx: ITransactionInfo
  ) => JSX.Element | null;
  getTxStatus: (tisCanceled: boolean, isConfirmed: boolean) => JSX.Element;
  getTxStatusIcons: (txLabel: string) => JSX.Element;
  getTxType: (tx: any, isTxSent: boolean) => string;
  isOpenModal: boolean;
  isShowedGroupBar: (tx: ITransactionInfo, idx: number) => boolean;
  modalData: modalDataType;
  txId: string;
}
