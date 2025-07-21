/* eslint-disable no-shadow */
export type Message = {
  data: any;
  id: string;
  type: string;
};

// Method handler types
export enum MethodHandlerType {
  Eth = 'eth',
  Internal = 'internal',
  Sys = 'sys',
  Wallet = 'wallet',
}

// Network requirements
export enum NetworkRequirement {
  Any = 'any',
  EVM = 'evm',
  UTXO = 'utxo',
}

// Popup routes for methods that need UI
export enum MethodRoute {
  AddEthChain = 'add-EthChain',
  ChangeAccount = 'change-account',
  ChangeActiveConnectedAccount = 'change-active-connected-account',
  Connect = 'connect-wallet',
  DecryptKey = 'tx/decrypt',
  EncryptKey = 'tx/encryptKey',
  EthSign = 'tx/ethSign',
  Login = 'login',
  SendEthTx = 'tx/send/ethTx',
  SignPsbt = 'tx/sign-psbt',
  SignTx = 'tx/sign',
  SwitchEthChain = 'switch-EthChain',
  SwitchNetwork = 'switch-network',
  SwitchUtxoEvm = 'switch-UtxoEvm',
  WatchAsset = 'watch-asset',
}

// Method configuration
export interface IMethodConfig {
  allowHardwareWallet: boolean;
  cacheKey?: string;

  cacheTTL?: number;
  handlerType: MethodHandlerType;
  // UI/Popup configuration
  hasPopup: boolean;
  // Special flags
  isBlocking?: boolean;

  // Basic info
  name: string;

  // Network requirements
  networkRequirement: NetworkRequirement;
  popupEventName?: string;
  popupRoute?: MethodRoute;

  requiresActiveAccount?: boolean;
  requiresAuth: boolean;
  requiresConnection: boolean;

  // Middleware requirements
  requiresTabId: boolean;
  // Response handling
  returnsArray?: boolean;
}

// Method registry type
export type MethodRegistry = Record<string, IMethodConfig>;

// Enhanced request context for pipeline processing
export interface IEnhancedRequestContext {
  methodConfig: IMethodConfig;
  methodName?: string;
  originalRequest: {
    host: string;
    messageId?: string;
    method: string;
    network?: string;
    params?: any[];
    sender: chrome.runtime.MessageSender;
    type: string;
  };
  prefix?: string;
}

export enum HardWallets {
  LEDGER = 'LEDGER',
  TREZOR = 'TREZOR',
}

//TODO: addtype for rpc subscription notifications here
export enum PaliEvents {
  accountsChanged = 'pali_accountsChanged',
  addProperty = 'pali_addProperty',
  chainChanged = 'pali_chainChanged',
  isBitcoinBased = 'pali_isBitcoinBased',
  lockStateChanged = 'pali_unlockStateChanged',
  removeProperty = 'pali_removeProperty',
  xpubChanged = 'pali_xpubChanged',
}
export enum PaliSyscoinEvents {
  blockExplorerChanged = 'pali_blockExplorerChanged',
  lockStateChanged = 'pali_unlockStateChanged',
  xpubChanged = 'pali_xpubChanged',
}
