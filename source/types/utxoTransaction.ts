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
  accountAssetTransfers?: any[];
  addressValueIn?: string;
  addressValueOut?: string;
  blockHash: string;
  blockHeight: number;
  blockTime: number;
  confirmationETABlocks?: number;
  confirmationETASeconds?: number;
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
