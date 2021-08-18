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

declare module 'extensionizer';

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

declare interface IMessagesController {}

declare interface IAccountController {
  addNewAccount: (label: string) => Promise<string | null>;
  clearTransactionItem: (item: any) => void;
  confirmIssueNFT: () => Promise<any>;
  confirmIssueSPT: () => Promise<any>;
  confirmNewSPT: () => Promise<any>;
  confirmSignature: (sendPSBT: boolean) => any;
  confirmTempTx: () => Promise<any>;
  confirmTransferOwnership: () => any;
  confirmUpdateAssetTransaction: () => any;
  createSPT: (spt: ISPTInfo) => void;
  getAssetguidFromTokenTransfers: (tokenTransfers: any) => Promise<string>;
  getChangeAddress: () => Promise<string>;
  getConnectedAccount: () => IAccountState;
  getConnectedAccount: () => IAccountState;
  getConnectedAccountXpub: () => string;
  getConnectedAccountXpub: () => string;
  getDataAsset: (assetGuid: any) => any;
  getDataFromPageToInitTransaction: () => any;
  getHoldingsData: () => any;
  getLatestUpdate: () => void;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  getRawTransaction: (txid: string) => any;
  getRecommendFee: () => Promise<number>;
  getSysExplorerSearch: () => string;
  getTransactionData: (txid: string) => any;
  getTransactionInfoByTxId: (txid: any) => any;
  getTransactionItem: () => any | null;
  getUserMintedTokens: () => any;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string, network: string) => boolean | undefined;
  issueNFT: (nft: INFTIssue) => void;
  issueSPT: (spt: ISPTIssue) => void;
  setCurrentPSBT: (psbt: any) => any;
  setCurrentPsbtToSign: (psbtToSign: any) => any;
  setDataFromPageToCreateNewSPT: (data: any) => void;
  setDataFromPageToMintNFT: (data: any) => void;
  setDataFromPageToMintSPT: (data: any) => void;
  setDataFromPageToTransferOwnership: (data: any) => void;
  setDataFromPageToUpdateAsset: (data: any) => void;
  setDataFromWalletToCreateSPT: (data: any) => void;
  setDataFromWalletToMintNFT: (data: any) => void;
  setDataFromWalletToMintSPT: (data: any) => void;
  updateAccountLabel: (id: number, label: string) => void;
  updateTempTx: (tx: ITransactionInfo) => void;
  updateTokensState: () => any;
  updateTxs: () => void;
  watchMemPool: (currentAccount: IAccountState) => void;
  setDataFromWalletToTransferOwnership: (data: any) => void;
  setNewXpub: (id: number, xpub: string, xprv: string) => boolean;
  setDataFromWalletToUpdateAsset: (data: any) => void;
  setUpdateAsset: (asset: any) => any;
  updateTokensState: () => any;
  setNewAddress: (addr: string) => boolean;
  subscribeAccount: (isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  setHDSigner: (accountId: number) => any;
  setNewOwnership: (data: any) => any;
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
  precision: number,
  symbol: string
}

declare type UpdateAssetItems = {
  assetGuid: string,
  auxfeedetails?: {
    auxfees: [{
      bound: any | 0,
      percent: any | 0
    }]
  },
  capabilityflags?: string,
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
  getChangeAddress: () => any;
  getConnectedAccount: () => any;
  getConnectedAccountXpub: () => any;
  getDataAsset: (assetGuid: any) => any;
  getHoldingsData: () => any;
  getUserMintedTokens: () => Promise<any>;
  getWalletState: () => any;
  handleCreateNFT: (items: CreateAndIssueNFTItems) => any;
  handleCreateToken: (items: CreateTokenItems) => any;
  handleIssueNFT: (amount: number, assetGuid: string) => any;
  handleIssueSPT: (items: IssueTokenItems) => any;
  handleSendToken: (items: SendTokenItems) => any;
  handleTransferOwnership: (items: TransferOwnershipItems) => any;
  handleUpdateAsset: (items: UpdateAssetItems) => any;
  isLocked: () => any;
  isNFT: (guid: number) => boolean;
  isValidSYSAddress: (address: string) => any;
  onWalletUpdate: (callback: any) => any;
  signTransaction: (psbt: any) => any;
  sign: (psbtToSign: any) => any;
}