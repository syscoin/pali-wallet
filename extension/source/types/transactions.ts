export type Transaction = {
  blockTime: number,
  confirmations: number,
  fees: number,
  tokenType: string,
  txid: string,
  value: number,
};

export type Assets = {
  assetGuid: number,
  balance: number,
  decimals: number,
  symbol: string,
  type: string,
};

export interface IAccountInfo {
  address?: string;
  assets: Assets[];
  balance: number;
  transactions: Transaction[];
}

export interface ITransactionInfo {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf: boolean;
  toAddress: string;
  token: Assets | null;
}

export type PendingTx = {
  blockTime: number,
  confirmations: number,
  fees: number,
  txid: string,
  value: number,
};

export type NotaryDetails = {
  endpoint?: string | null;
  hdrequired?: boolean;
  instanttransfers?: boolean;
}

export type AuxFees = {
  [auxfees: number]: {
    bound: number;
    percent: number;
  }
}

export type NewAsset = {
  precision: number | 8;
  symbol: string;
  maxsupply: number;
  description?: string;
  receiver?: string;
  fee: number;
  advanced?: {
    initialSupply?: number;
    capabilityflags?: string | '127';
    notarydetails?: NotaryDetails;
    auxfeedetails?: AuxFees[];
    notaryAddress?: string;
    payoutAddress?: string;
  }
}

export type SentAsset = {
  amount: number;
  fee: number;
  isToken: boolean;
  rbf?: boolean;
  receiver: string;
  sender: string;
  token: string;
}

export type MintAsset = {
  fee: number;
  amount: number;
  assetGuid: string;
}

export type NewNFT = {
  fee: number;
  symbol: string;
  description: string;
  receiver: string;
  precision: number;
}

export type UpdateAsset = {
  fee: number;
  assetGuid: number;
  assetWhiteList: string;
  capabilityflags: string | '127';
  contract: string;
  description: string;
  advanced?: {
    notarydetails?: NotaryDetails;
    auxfeedetails?: AuxFees[];
    notaryAddress?: string;
    payoutAddress?: string;
  }
}

export type TransferAsset = {
  assetGuid: string;
  newOwner: string;
  fee: number;
}

export type SendAsset = {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf?: boolean;
  toAddress: string;
  token: Assets | null;
}

export type TemporaryTransaction = {
  newAsset: NewAsset | null;
  mintAsset: MintAsset | null;
  newNFT: NewNFT | null;
  updateAsset: UpdateAsset | null;
  transferAsset: TransferAsset | null;
  sendAsset: SendAsset | null;
  signPSBT: any | null;
  signAndSendPSBT: any | null;
  mintNFT: MintAsset | null;
}

export enum TxTypes {
  Creation,
  Mint,
  Update,
  Ownership,
  Send
}
