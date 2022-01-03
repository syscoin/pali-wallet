import { IAccountState } from 'state/wallet/types';
import { MintAsset, NewAsset, NewNFT, SendAsset, TransferAsset, UpdateAsset } from './transactions';

export interface IWalletController {
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

export interface IAccountController {
  updateNetworkData: ({ id, label, beUrl }: any) => any;
  clearTemporaryTransaction: (item: string) => void;
  confirmTemporaryTransaction: ({ type: string, callback: any }) => Promise<any>;
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
  getTransactionInfoByTxId: (txid: any) => any;
  getUserMintedTokens: () => any;
  isValidSYSAddress: (address: string, network: string, verification?: boolean) => boolean | undefined;
  updateAccountLabel: (id: number, label: string) => void;
  updateTxs: () => void;
  watchMemPool: (currentAccount: IAccountState) => void;
  setNewXpub: (id: number, xpub: string, xprv: string, key: string) => boolean;
  updateTokensState: () => any;
  setNewAddress: (addr: string) => boolean;
  subscribeAccount: (encriptedPassword: any, isHardwareWallet: boolean, sjs?: any, label?: string, walletCreation?: boolean) => Promise<string | null>;
  setHDSigner: (accountId: number) => any;
  importPsbt: (psbt: any) => any;
  decryptAES: (encryptedString: any, key: string) => any;
  setAutolockTimer: (minutes: number) => any;
  updateTemporaryTransaction: ({ tx: any, type: string }) => any;
  getTemporaryTransaction: (type: string) => any;
  confirmSendAssetTransaction: (items: SendAsset) => any;
  confirmSPTCreation: (item: NewAsset) => any;
  confirmMintSPT: (item: MintAsset) => any;
  confirmCreateNFT: (item: NewNFT) => any;
  signTransaction: (psbt: any, type: boolean) => any;
  confirmAssetTransfer: (item: TransferAsset) => any;
  confirmMintNFT: (item: any) => any;
  confirmUpdateAsset: (item: UpdateAsset) => any;
}

export interface IConnectionsController {
  connectWallet: () => any;
  getChangeAddress: () => any | null;
  getConnectedAccount: () => any | null;
  getConnectedAccountXpub: () => any | null;
  getDataAsset: (assetGuid: any) => any | null;
  getHoldingsData: () => any | null;
  getUserMintedTokens: () => Promise<any> | null;
  getWalletState: () => any | null;
  handleCreateNFT: (items: NewNFT) => Promise<any> | null;
  handleCreateToken: (items: NewAsset) => Promise<any> | null;
  handleIssueNFT: (amount: number, assetGuid: string) => Promise<any> | null;
  handleIssueSPT: (items: MintAsset) => Promise<any> | null;
  handleSendToken: (items: SendAsset) => Promise<any> | null;
  handleTransferOwnership: (items: TransferAsset) => Promise<any> | null;
  handleUpdateAsset: (items: UpdateAsset) => Promise<any> | null;
  isLocked: () => any;
  isNFT: (guid: number) => boolean | null;
  isValidSYSAddress: (address: string) => any | null;
  onWalletUpdate: (callback: any) => any;
  signAndSend: (psbt: any) => Promise<any> | null;
  signPSBT: (psbtToSign: any) => Promise<any> | null;
}