import {
  INetworkType,
  INetwork,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-utils';

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
  confirmAssetTransfer: (item: TransferAsset) => any;
  confirmCreateNFT: (item: NewNFT) => any;
  confirmMintNFT: (item: any) => any;
  confirmMintSPT: (item: MintAsset) => any;
  confirmSPTCreation: (item: NewAsset) => any;
  confirmSendAssetTransaction: (items: SendAsset) => any;
  confirmUpdateAsset: (item: UpdateAsset) => any;
  connectedAccountXpub: string | null;
  decryptAES: (encryptedString: any, key: string) => any;
  getActiveAccount: () => IKeyringAccountState | undefined;
  getChangeAddress: () => Promise<string>;
  getConnectedAccount: () => IKeyringAccountState | undefined;
  getDataAsset: (assetGuid: any) => any;
  getHoldingsData: () => any;
  getLatestUpdate: () => void;
  getPrimaryAccount: (pwd: string, sjs: any) => void;
  getRawTransaction: (txid: string) => any;
  getRecommendFee: () => Promise<number>;
  getSysExplorerSearch: () => string;
  getTransactionInfoByTxId: (txid: any) => any;
  getUserMintedTokens: () => any;
  importPsbt: (psbt: any) => any;
  isValidSYSAddress: (
    address: string,
    networkId: number,
    verification?: boolean
  ) => boolean | undefined;
  removeCustomRpc: (
    prefix: INetworkType.Syscoin | INetworkType.Ethereum,
    chainId: number
  ) => void;
  setAutolockTimer: (minutes: number) => any;
  setHDSigner: (accountId: number) => any;
  setNewAddress: (addr: string) => boolean;
  setNewXpub: (xpub: string, xprv: string, key: string) => void;
  signTransaction: (psbt: any, type: boolean) => any;
  subscribeAccount: (
    isHardwareWallet: boolean,
    sjs?: any,
    label?: string,
    walletCreation?: boolean
  ) => Promise<string | null>;
  temporaryTransaction: TemporaryTransaction;
  updateAccountLabel: (id: number, label: string) => void;
  updateNetworkData: (
    prefix: INetworkType.Syscoin | INetworkType.Ethereum,
    network: INetwork
  ) => void;
  updateTokensState: () => any;
  updateTxs: () => void;
  watchMemPool: (currentAccount: IKeyringAccountState) => void;
}
