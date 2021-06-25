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
  getTempTx: () => ITransactionInfo | null;
  getNewSPT: () => ISPTInfo | null;
  getIssueSPT: () => ISPTIssue | null;
  getIssueNFT: () => INFTIssue | null;
  getNewUpdateAsset: () => any | null;
  getNewOwnership: () => any | null;
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
  createCollection: (collectionName: string, description: string, sysAddress: string, symbol: any, property1?: string, property2?: string, property3?: string, attribute1?: string, attribute2?: string, attribute3?: string) => void;
  getCollection: () => any;
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
