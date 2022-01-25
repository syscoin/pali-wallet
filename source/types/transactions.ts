export type Transaction = {
  blockTime: number;
  confirmations: number;
  fees: number;
  tokenType: string;
  txid: string;
  value: number;
};

export type Assets = {
  assetGuid: number;
  balance: number;
  decimals: number;
  symbol: string;
  type: string;
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
  blockTime: number;
  confirmations: number;
  fees: number;
  txid: string;
  value: number;
};

export type NotaryDetails = {
  endpoint?: string | null;
  hdrequired?: boolean;
  instanttransfers?: boolean;
};

export type AuxFees = {
  [auxfees: number]: {
    bound: number;
    percent: number;
  };
};

export type NewAsset = {
  advanced?: {
    auxfeedetails?: AuxFees[];
    capabilityflags?: string | '127';
    initialSupply?: number;
    notaryAddress?: string;
    notarydetails?: NotaryDetails;
    payoutAddress?: string;
  };
  description?: string;
  fee: number;
  maxsupply: number;
  precision: number | 8;
  receiver?: string;
  symbol: string;
};

export type SentAsset = {
  amount: number;
  fee: number;
  isToken: boolean;
  rbf?: boolean;
  receiver: string;
  sender: string;
  token: string;
};

export type MintAsset = {
  amount: number;
  assetGuid: string;
  fee: number;
};

export type NewNFT = {
  description: string;
  fee: number;
  precision: number;
  receiver: string;
  symbol: string;
};

export type UpdateAsset = {
  advanced?: {
    auxfeedetails?: AuxFees[];
    notaryAddress?: string;
    notarydetails?: NotaryDetails;
    payoutAddress?: string;
  };
  assetGuid: number;
  assetWhiteList: string;
  capabilityflags: string | '127';
  contract: string;
  description: string;
  fee: number;
};

export type TransferAsset = {
  assetGuid: string;
  fee: number;
  newOwner: string;
};

export type SendAsset = {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf?: boolean;
  toAddress: string;
  token: Assets | null;
};

export type TemporaryTransaction = {
  mintAsset: MintAsset | null;
  mintNFT: MintAsset | null;
  newAsset: NewAsset | null;
  newNFT: NewNFT | null;
  sendAsset: SendAsset | null;
  signAndSendPSBT: any | null;
  signPSBT: any | null;
  transferAsset: TransferAsset | null;
  updateAsset: UpdateAsset | null;
};

export interface IETHTxConfig {
  gasLimit?: number;
  gasPrice: number;
  memo?: string;
  nonce?: number;
  txData?: string;
}

export interface IETHPendingTx {
  amount: string;
  assetId: string;
  data?: string;
  fromAddress: string;
  gasPrice: number;
  network: ETHNetwork;
  nonce: number;
  onConfirmed?: () => void;
  timestamp: number;
  toAddress: string;
  txHash: string;
}

export type ETHNetwork = 'testnet' | 'mainnet';
