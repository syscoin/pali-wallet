import { IAccountState, INetwork } from 'state/wallet/types';

import {
  MintAsset,
  NewAsset,
  NewNFT,
  SendAsset,
  TransferAsset,
  UpdateAsset,
  TemporaryTransaction,
} from './transactions';

export interface IWalletController {
  account: Readonly<IAccountController>;
  addNewAccount: (label?: string) => Promise<string | null>;
  checkPassword: (pwd: string) => boolean;
  createWallet: (isUpdated?: boolean) => void;
  encryptedPassword: string;
  forgetWallet: (pwd: string) => void;
  generatePhrase: () => string | null;
  getNewAddress: () => Promise<boolean>;
  getPhrase: (pwd: string) => string | null;
  importPhrase: (phr: string) => boolean;
  isLocked: () => boolean;
  logOut: () => void;
  mnemonic: string;
  password: string;
  setWalletPassword: (pwd: string) => void;
  switchNetwork: (networkId: number, prefix: string) => void;
  switchWallet: (id: number) => void;
  trezor: Readonly<any>;
  unLock: (pwd: string) => Promise<boolean>;
}

export interface IAccountController {
  clearTemporaryTransaction: (item: string) => void;
  confirmAssetTransfer: (item: TransferAsset) => any;
  confirmCreateNFT: (item: NewNFT) => any;
  confirmMintNFT: (item: any) => any;
  confirmMintSPT: (item: MintAsset) => any;
  confirmSPTCreation: (item: NewAsset) => any;
  confirmSendAssetTransaction: (items: SendAsset) => any;
  confirmTemporaryTransaction: ({
    type: string,
    callback: any,
  }) => Promise<any>;
  confirmUpdateAsset: (item: UpdateAsset) => any;
  connectedAccountXpub: string | null;
  decryptAES: (encryptedString: any, key: string) => any;
  getActiveAccount: () => IAccountState | undefined;
  getChangeAddress: () => Promise<string>;
  getConnectedAccount: () => IAccountState | undefined;
  getDataAsset: (assetGuid: any) => any;
  getHoldingsData: () => any;
  getLatestUpdate: () => void;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  getRawTransaction: (txid: string) => any;
  getRecommendFee: () => Promise<number>;
  getSysExplorerSearch: () => string;
  getTemporaryTransaction: (type: string) => any;
  getTransactionInfoByTxId: (txid: any) => any;
  getUserMintedTokens: () => any;
  importPsbt: (psbt: any) => any;
  isValidSYSAddress: (
    address: string,
    networkId: number,
    verification?: boolean
  ) => boolean | undefined;
  setAutolockTimer: (minutes: number) => any;
  setHDSigner: (accountId: number) => any;
  setNewAddress: (addr: string) => boolean;
  setNewXpub: (id: number, xpub: string, xprv: string, key: string) => void;
  signTransaction: (psbt: any, type: boolean) => any;
  subscribeAccount: (
    isHardwareWallet: boolean,
    sjs?: any,
    label?: string,
    walletCreation?: boolean
  ) => Promise<string | null>;
  temporaryTransaction: TemporaryTransaction;
  updateAccountLabel: (id: number, label: string) => void;
  updateNetworkData: (network: INetwork) => void;
  updateTemporaryTransaction: ({ tx: any, type: string }) => any;
  updateTokensState: () => any;
  updateTxs: () => void;
  watchMemPool: (currentAccount: IAccountState) => void;
}
