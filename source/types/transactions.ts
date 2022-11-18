export interface ITransaction {
  blockTime: number;
  confirmations: number;
  fees: number;
  tokenType: string;
  txid: string;
  value: number;
}

export interface IAssets {
  assetGuid: number;
  balance: number;
  decimals: number;
  symbol: string;
  type: string;
}

export interface IToken {
  address: string;
  chainId: number;
  decimals: number;
  logoURI: string;
  name: string;
  symbol: string;
}

export interface IAccountInfo {
  address?: string | null;
  assets: IAssets[];
  balance: number;
  transactions: ITransaction[];
}

export interface ITransactionInfo {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf: boolean;
  toAddress: string;
  token: IAssets | null;
}

export interface IPendingTx {
  blockTime: number;
  confirmations: number;
  fees: number;
  txid: string;
  value: number;
}

export interface INotaryDetails {
  endpoint?: string | null;
  hdrequired?: boolean;
  instanttransfers?: boolean;
}

export interface IAuxFees {
  [auxfees: number]: {
    bound: number;
    percent: number;
  };
}

export interface INewAsset {
  advanced?: {
    auxfeedetails?: IAuxFees[];
    capabilityflags?: string | '127';
    initialSupply?: number;
    notaryAddress?: string;
    notarydetails?: INotaryDetails;
    payoutAddress?: string;
  };
  description?: string;
  fee: number;
  maxsupply: number;
  precision: number | 8;
  receiver?: string;
  symbol: string;
}

export interface ISentAsset {
  amount: number;
  fee: number;
  isToken: boolean;
  rbf?: boolean;
  receiver: string;
  sender: string;
  token: string;
}

export interface IMintAsset {
  amount: number;
  assetGuid: string;
  fee: number;
}

export interface INewNFT {
  description: string;
  fee: number;
  precision: number;
  receiver: string;
  symbol: string;
}

export interface IUpdateAsset {
  advanced?: {
    auxfeedetails?: IAuxFees[];
    notaryAddress?: string;
    notarydetails?: INotaryDetails;
    payoutAddress?: string;
  };
  assetGuid: number;
  assetWhiteList: string;
  capabilityflags: string | '127';
  contract: string;
  description: string;
  fee: number;
}

export interface ITransferAsset {
  assetGuid: string;
  fee: number;
  newOwner: string;
}

export interface ISendAsset {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf?: boolean;
  toAddress: string;
  token: IAssets | null;
}

export interface ITemporaryTransaction {
  mintAsset: IMintAsset | null;
  mintNFT: IMintAsset | null;
  newAsset: INewAsset | null;
  newNFT: INewNFT | null;
  sendAsset: ISendAsset | null;
  signAndSendPSBT: any | null;
  signPSBT: any | null;
  transferAsset: ITransferAsset | null;
  updateAsset: IUpdateAsset | null;
}

export interface ICustomRpcParams {
  apiUrl?: string;
  chainId: number;
  isSyscoinRpc?: boolean;
  label: string;
  url: string;
}

export interface ITransactionParams {
  data: string;
  from: string;
  gas: string;
  to: string;
  value: number;
}
