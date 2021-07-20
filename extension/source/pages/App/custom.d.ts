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
  checkPassword: (pwd: string) => boolean;
  createHardwareWallet: () => void;
  createWallet: (isUpdated?: boolean) => void;
  deleteWallet: (pwd: string) => void;
  generatePhrase: () => string | null;
  getNewAddress: () => Promise<boolean>;
  getPhrase: (pwd: string) => string | null;
  importPhrase: (phr: string) => boolean;
  isLocked: () => boolean;
  logOut: () => void;
  setWalletPassword: (pwd: string) => void;
  switchNetwork: (networkId: string) => void;
  switchWallet: (id: number) => void;
  unLock: (pwd: string) => boolean;
}

declare interface IAccountController {
  addNewAccount: (label: string) => Promise<string | null>;
  clearTransactionItem: (item: any) => void;
  confirmIssueNFT: () => Promise<any>;
  confirmIssueSPT: () => Promise<any>;
  confirmNewSPT: () => Promise<any>;
  confirmTempTx: () => Promise<any>;
  confirmTransferOwnership: () => any;
  confirmUpdateAssetTransaction: () => any;
  createSPT: (spt: ISPTInfo) => void;
  getDataAsset: (assetGuid: any) => any;
  getDataFromPageToInitTransaction: () => any;
  getHoldingsData: () => any;
  getLatestUpdate: () => void;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  getRecommendFee: () => Promise<number>;
  getSysExplorerSearch: () => string;
  getTransactionInfoByTxId: (txid: any) => any;
  getTransactionItem: () => any | null;
  getUserMintedTokens: () => any;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string, network: string) => boolean | undefined;
  issueNFT: (nft: INFTIssue) => void;
  issueSPT: (spt: ISPTIssue) => void;
  setDataFromPageToCreateNewSPT: (data: any) => void;
  setDataFromPageToMintNFT: (data: any) => void;
  setDataFromPageToMintSPT: (data: any) => void;
  setDataFromPageToTransferOwnership: (data: any) => void;
  setDataFromPageToUpdateAsset: (data: any) => void;
  setDataFromWalletToCreateSPT: (data: any) => void;
  setDataFromWalletToMintNFT: (data: any) => void;
  setDataFromWalletToMintSPT: (data: any) => void;
  setDataFromWalletToTransferOwnership: (data: any) => void;
  setDataFromWalletToUpdateAsset: (data: any) => void;
  setNewAddress: (addr: string) => boolean;
  setNewOwnership: (data: any) => any;
  setNewXpub: (id: number, xpub: string, xprv: string) => boolean;
  setUpdateAsset: (asset: any) => any;
  subscribeAccount: (isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  updateAccountLabel: (id: number, label: string) => void;
  updateTempTx: (tx: ITransactionInfo) => void;
  updateTxs: () => void;
  watchMemPool: () => void;
  confirmSignature: () => any;
  getConnectedAccount: () => IAccountState;
  getConnectedAccountXpub: () => string;
  setCurrentPSBT: (psbt: any) => any;
  updateTokensState: () => any;
}

declare type CreateTokenItems = {
  auxfeedetails?: {
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  capabilityflags?: string,
  description: string,
  initialSupply?: number | 0,
  maxsupply: number,
  notaryAddress?: string,
  notarydetails?: {
    endpoint?: string | null,
    hdrequired?: boolean,
    instanttransfers?: boolean
  },
  payoutAddress?: string,
  precision: number,
  receiver: string,
  symbol: string
}

declare type SendTokenItems = {
  amount: number,
  fee: number,
  isToken: boolean,
  rbf: boolean,
  receiver: string,
  sender: string,
  token: any
}

declare type IssueTokenItems = {
  amount: number,
  assetGuid: string
}

declare type CreateAndIssueNFTItems = {
  auxfeedetails?: {
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  description: string,
  issuer: string,
  notaryAddress?: string,
  notarydetails?: {
    endpoint?: string | null,
    hdrequired?: boolean,
    instanttransfers?: boolean
  },
  payoutAddress?: string,
  symbol: string,
  totalShares: number
}

declare type UpdateAssetItems = {
  assetGuid: string,
  auxfeedetails?: {
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  capabilityflags?: string | '127',
  contract?: string,
  description?: string,
  notaryAddress?: string,
  notarydetails?: {
    endpoint?: string | null,
    hdrequired?: boolean,
    instanttransfers?: boolean
  },
  payoutAddress?: string
}

declare type TransferOwnershipItems = {
  assetGuid: string,
  newOwner: string
}

declare interface IConnectionsController {
  connectWallet: () => any;
  signTransaction: (psbt: any) => any;
  getConnectedAccount: () => any;
  getDataAsset: (assetGuid: any) => any;
  getHoldingsData: () => any;
  getUserMintedTokens: () => Promise<any>;
  getWalletState: () => any;
  handleCreateNFT: (items: CreateAndIssueNFTItems) => any;
  handleCreateToken: (items: CreateTokenItems) => any;
  handleIssueNFT: (amount: number, assetGuid: string) => any;
  handleIssueSPT: (items: IssueTokenItems) => any;
  isLocked: () => any;
  handleSendToken: (items: SendTokenItems) => any;
  handleTransferOwnership: (items: TransferOwnershipItems) => any;
  handleUpdateAsset: (items: UpdateAssetItems) => any;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string) => any;
  onWalletUpdate: (callback: any) => any;
  getConnectedAccountXpub: () => any;
}