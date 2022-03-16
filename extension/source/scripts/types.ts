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

export interface ISPTInfo {
  description: string;
  fee: number;
  maxsupply: number;
  precision: number;
  receiver: string;
  symbol: string;
}

export interface ISPTPageInfo {
  description: string;
  maxsupply: number;
  precision: number;
  receiver: string;
  symbol: string;
}

export interface ISPTWalletInfo {
  fee: number;
}

export interface ISPTIssue {
  amount: number;
  assetGuid: string;
  fee: number;
}

export interface ISPTIssuePage {
  amount: number;
  assetGuid: string;
}

export interface ISPTIssueWallet {
  fee: number;
}

export interface INFTIssue {
  assetGuid: string;
  fee: number;
}

export interface INFTPageInfo {
  assetGuid: string;
}

export interface INFTWalletInfo {
  fee: number;
}

export type PendingTx = {
  blockTime: number,
  confirmations: number,
  fees: number,
  txid: string,
  value: number,
};

export type MintedToken = {
  assetGuid: string,
  maxSupply: number,
  symbol: string,
  totalSupply: number,
};

export type UpdateToken = {
  assetGuid: string,
  assetWhiteList?: any | null,
  auxfeedetails?: any,
  capabilityflags?: string | '127',
  contract?: string | null,
  description: string | null,
  fee: number,
  notaryAddress?: string,
  notarydetails?: {
    endpoint?: string,
    hdrequired?: boolean,
    instanttransfers?: boolean,
  },
  notarykeyid?: string,
  payoutAddress?: string | null,
};

export interface UpdateTokenPageInfo {
  assetWhiteList?: any | null;
  auxfeedetails?: {
    auxfees?: [
      {
        bound?: any,
        percent?: any,
      }
    ],
  };
  capabilityflags?: string | '127';
  contract?: string;
  description: string | '';
  notarydetails?: {
    endpoint?: string,
    hdrequired?: boolean,
    instanttransfers?: boolean,
  };
  notarykeyid?: string;
  receiver?: string;
}

export interface UpdateTokenWalletInfo {
  fee: number;
}
