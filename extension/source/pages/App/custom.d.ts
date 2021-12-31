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
  unLock: (pwd: string) => Promise<boolean>;
  addNewAccount: (label?: string) => Promise<string | null>;
}

declare interface IMessagesController { }

declare interface IAccountController {
  updateNetworkData: ({ id, label, beUrl }: any) => any;
  clearTemporaryTransaction: (item: string) => void;
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
  isValidSYSAddress: (address: string, network: string, verification?: boolean) => boolean | undefined;
  issueNFT: (nft: INFTIssue) => void;
  issueSPT: (spt: ISPTIssue) => void;
  setCurrentPSBT: (psbt: any) => any;
  setCurrentPsbtToSign: (psbtToSign: any) => any;
  updateAccountLabel: (id: number, label: string) => void;
  updateTempTx: (tx: any, item: string) => void;
  updateTokensState: () => any;
  updateTxs: () => void;
  watchMemPool: (currentAccount: IAccountState) => void;
  setNewXpub: (id: number, xpub: string, xprv: string, key: string) => boolean;
  setUpdateAsset: (asset: any) => any;
  updateTokensState: () => any;
  setNewAddress: (addr: string) => boolean;
  subscribeAccount: (encriptedPassword: any, isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  setHDSigner: (accountId: number) => any;
  setNewOwnership: (data: any) => any;
  confirmIssueNFTTx: () => any;
  setNewIssueNFT: (data: any) => any;
  importPsbt: (psbt: any) => any;
  decryptAES: (encryptedString: any, key: string) => any;
  setAutolockTimer: (minutes: number) => any;
  updateTemporaryTransaction: (params: any) => any;
  getTemporaryTransaction: (type: string) => any;
}

declare type NotaryDetails = {
  endpoint?: string | null;
  hdrequired?: boolean;
  instanttransfers?: boolean;
}

declare type AuxFees = {
  [auxfees: number]: {
    bound: number;
    percent: number;
  }
}

declare type NewAsset = {
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

declare type SentAsset = {
  amount: number;
  fee: number;
  isToken: boolean;
  rbf?: boolean;
  receiver: string;
  sender: string;
  token: string;
}

declare type MintedAsset = {
  amount: number;
  assetGuid: string;
}

declare type NewNFT = {
  fee: number;
  symbol: string;
  description: string;
  receiver: string;
  precision: number;
}

declare type UpdatedAsset = {
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

declare type TransferredAsset = {
  assetGuid: string;
  newOwner: string;
}

declare type SendAsset = {
  amount: number;
  fee: number;
  fromAddress: string;
  isToken: boolean;
  rbf?: boolean;
  toAddress: string;
  token: Assets | null;
}

declare type TemporaryTransaction = {
  newAsset: NewAsset | null;
  mintedAsset: MintedAsset | null;
  newNFT: NewNFT | null;
  updatedAsset: UpdatedAsset | null;
  transferredAsset: TransferredAsset | null;
  sendAsset: SendAsset | null;
}

enum TxTypes {
  Creation,
  Mint,
  Update,
  Ownership
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
  handleCreateToken: (items: NewAsset) => Promise<any> | null;
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
