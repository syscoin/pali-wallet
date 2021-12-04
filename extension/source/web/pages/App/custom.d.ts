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

declare module 'constants/index';

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
  addNewAccount: (label: string) => Promise<string | null>;
}

declare interface IMessagesController { }

declare interface IAccountController {
  clearTransactionItem: (item: any) => void;
  confirmIssueNFT: () => Promise<any>;
  confirmIssueSPT: () => Promise<any>;
  confirmNewSPT: () => Promise<any>;
  confirmSignature: (sendPSBT: boolean) => any;
  confirmTempTx: () => Promise<any>;
  confirmTransferOwnership: () => any;
  confirmUpdateAssetTransaction: () => any;
  createSPT: (spt: ISPTInfo) => void;
  getChangeAddress: () => Promise<string>;
  getConnectedAccount: () => IAccountState;
  getConnectedAccountXpub: () => string | null;
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
  setNewXpub: (id: number, xpub: string, xprv: string, key: string) => boolean;
  setDataFromWalletToUpdateAsset: (data: any) => void;
  setUpdateAsset: (asset: any) => any;
  updateTokensState: () => any;
  setNewAddress: (addr: string) => boolean;
  subscribeAccount: (encriptedPassword: any, isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  setHDSigner: (accountId: number) => any;
  setNewOwnership: (data: any) => any;
  confirmIssueNFTTx: () => any;
  setNewIssueNFT: (data: any) => any;
  setDataFromPageToIssueNFT: (data: any) => any;
  setDataFromWalletToIssueNFT: (data: any) => any;
  importPsbt: (psbt: any) => any;
  decryptAES: (encryptedString: any, key: string) => any;
  setAutolockTimer: (minutes: number) => any;
}

declare type CreateTokenItems = {
  auxfeedetails?: {
    auxfees: [{
      bound: any,
      percent: any,
    }]
  },
  capabilityflags?: string | '127',
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
  token: string
}

declare type IssueTokenItems = {
  amount: number,
  assetGuid: string
}

declare type CreateAndIssueNFTItems = {
  auxfeedetails?: {
    auxfees: [{
      bound: any,
      percent: any
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
      bound: any,
      percent: any
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
  getChangeAddress: () => any | null;
  getConnectedAccount: () => any | null;
  getConnectedAccountXpub: () => any | null;
  getDataAsset: (assetGuid: any) => any | null;
  getHoldingsData: () => any | null;
  getUserMintedTokens: () => Promise<any> | null;
  getWalletState: () => any | null;
  handleCreateNFT: (items: CreateAndIssueNFTItems) => Promise<any> | null;
  handleCreateToken: (items: CreateTokenItems) => Promise<any> | null;
  handleIssueNFT: (amount: number, assetGuid: string) => Promise<any> | null;
  handleIssueSPT: (items: IssueTokenItems) => Promise<any> | null;
  handleSendToken: (items: SendTokenItems) => Promise<any> | null;
  handleTransferOwnership: (items: TransferOwnershipItems) => Promise<any> | null;
  handleUpdateAsset: (items: UpdateAssetItems) => Promise<any> | null;
  isLocked: () => any;
  isNFT: (guid: number) => boolean | null;
  isValidSYSAddress: (address: string) => any | null;
  onWalletUpdate: (callback: any) => any;
  signAndSend: (psbt: any) => Promise<any> | null;
  signPSBT: (psbtToSign: any) => Promise<any> | null;
}
