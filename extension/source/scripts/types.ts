export type Transaction = {
  hash : string;
  amount : number;
  receiver : string;
  sender : string;
  fee : number;
  isDummy : true;
  timeAgo?: string;
  timestamp: string;
  lastTransactionRef : {
    prevHash : string;
    ordinal : number
  };
  snapshotHash : string;
  checkpointBlock : string;
  pending?: boolean;
  pendingMsg?: string;
}

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

export type PendingTx = {
  timestamp: number;
  hash: string;
  amount: number;
  receiver: string;
  sender: string;
}