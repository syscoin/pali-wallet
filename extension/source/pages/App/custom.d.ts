declare module '*.scss' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.png' {
  const value: string;
  export default value;
}

declare module '*.svg' {
  const value: string;
  export default value;
}

declare module 'react-alert';

declare module 'bip84';

declare interface IWalletController {
  account: Readonly<IAccountController>;
  setWalletPassword: (pwd: string) => void;
  isLocked: () => boolean;
  generatePhrase: () => string | null;
  createWallet: (isUpdated?: boolean) => void;
  createHardwareWallet: () => void;
  unLock: (pwd: string) => boolean;
  checkPassword: (pwd: string) => boolean;
  getPhrase: (pwd: string) => string | null;
  deleteWallet: (pwd: string) => void;
  importPhrase: (phr: string) => boolean;
  switchWallet: (id: number) => void;
  switchNetwork: (networkId: string) => void;
  getNewAddress: () => Promise<boolean>;
  logOut: () => void;
}

declare interface IAccountController {
  subscribeAccount: (isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  updateAccountLabel: (id: number, label: string) => void;
  addNewAccount: (label: string) => Promise<string | null>;
  getLatestUpdate: () => void;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  watchMemPool: () => void;
  isValidSYSAddress: (address: string, network: string) => boolean | undefined;
  isNFT: (guid: number) => boolean;
  getRecommendFee: () => Promise<number>;
  updateTxs: () => void;
  getTransactionItem: () => any | null;
  updateTempTx: (tx: ITransactionInfo) => void;
  setNewAddress: (addr: string) => boolean;
  setNewXpub: (id: number, xpub: string, xprv: string) => boolean;
  getDataFromPageToInitTransaction: () => any;
  createSPT: (spt: ISPTInfo) => void;
  issueSPT: (spt: ISPTIssue) => void;
  issueNFT: (nft: INFTIssue) => void;
  confirmNewSPT: () => Promise<any>;
  confirmIssueSPT: () => Promise<any>;
  confirmIssueNFT: () => Promise<any>;
  confirmTempTx: () => Promise<any>;
  getUserMintedTokens: () => any;
  getTransactionInfoByTxId: (txid: any) => any;
  getSysExplorerSearch: () => string;
  setDataFromPageToCreateNewSPT: (data: any) => void;
  setDataFromWalletToCreateSPT: (data: any) => void;
  setDataFromPageToMintSPT: (data: any) => void;
  setDataFromWalletToMintSPT: (data: any) => void;
  setDataFromPageToMintNFT: (data: any) => void;
  setDataFromWalletToMintNFT: (data: any) => void;
  setDataFromPageToUpdateAsset: (data: any) => void;
  setDataFromWalletToUpdateAsset: (data: any) => void;
  setDataFromPageToTransferOwnership: (data: any) => void;
  setDataFromWalletToTransferOwnership: (data: any) => void;
  confirmUpdateAssetTransaction: () => any;
  confirmTransferOwnership: () => any;
  setUpdateAsset: (asset: any) => any;
  setNewOwnership: (data: any) => any;
  getHoldingsData: () => any;
  getDataAsset: (assetGuid: any) => any;
  clearTransactionItem: (item: any) => void;
}

declare type CreateTokenItems = {
  precision: number | 8,
  symbol: string,
  maxsupply: number,
  description: string,
  receiver: string,
  initialSupply?: number | 0,
  capabilityflags?: string,
  notarydetails?: {
    endpoint?: string | null,
    instanttransfers?: boolean,
    hdrequired?: boolean
  },
  auxfeedetails?: {
    auxfeekeyid: string,
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  notaryAddress?: string,
  payoutAddress?: string
}

declare type SendTokenItems = {
  sender: string,
  receiver: string,
  amount: number,
  fee: number,
  token: any,
  isToken: boolean,
  rbf: boolean
}

declare type IssueTokenItems = {
  amount: number,
  assetGuid: string
}

declare type CreateAndIssueNFTItems = {
  symbol: string,
  issuer: string,
  totalShares: number,
  description: string,
  notarydetails?: {
    endpoint?: string | null,
    instanttransfers?: boolean,
    hdrequired?: boolean
  },
  auxfeedetails?: {
    auxfeekeyid: string,
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  notaryAddress?: string,
  payoutAddress?: string
}

declare type UpdateAssetItems = {
  assetGuid: string,
  contract?: string,
  capabilityflags?: string | '127',
  description?: string,
  notarydetails?: {
    endpoint?: string | null,
    instanttransfers?: boolean,
    hdrequired?: boolean
  },
  auxfeedetails?: {
    auxfeekeyid: string,
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  notaryAddress?: string,
  payoutAddress?: string
}

declare type TransferOwnershipItems = {
  assetGuid: string,
  newOwner: string
}

declare interface IConnectionsController {
  connectWallet: () => any;
  onWalletUpdate: (callback: any) => any;
  getWalletState: () => any;
  getConnectedAccount: () => any;
  handleSendToken: (items: SendTokenItems) => any;
  handleCreateToken: (items: CreateTokenItems) => any;
  handleIssueSPT: (items: IssueTokenItems) => any;
  handleCreateNFT: (items: CreateAndIssueNFTItems) => any;
  handleIssueNFT: (amount: number, assetGuid: string) => any;
  isNFT: (guid: number) => boolean;
  getUserMintedTokens: () => Promise<any>;
  handleUpdateAsset: (items: UpdateAssetItems) => any;
  handleTransferOwnership: (items: TransferOwnershipItems) => any;
  isValidSYSAddress: (address: string) => any;
  getHoldingsData: () => any;
  getDataAsset: (assetGuid: any) => any;
}