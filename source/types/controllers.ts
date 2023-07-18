import { Runtime } from 'webextension-polyfill-ts';

import {
  IKeyringManager,
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';
import {
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { IEthAccountController } from 'scripts/Background/controllers/account/evm';
import { ISysAccountController } from 'scripts/Background/controllers/account/syscoin';
import { IAssetsManager } from 'scripts/Background/controllers/assets/types';
import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import {
  IEvmTransactionResponse,
  ISysTransaction,
  ITransactionsManager,
} from 'scripts/Background/controllers/transactions/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';

import { ICustomRpcParams } from './transactions';

export interface IMainController extends IKeyringManager {
  account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  addCustomRpc: (rpc: ICustomRpcParams) => Promise<INetwork>;
  addWindowEthProperty: () => void;
  assets: IAssetsManager;
  createAccount: (
    isBitcoinBased: boolean,
    activeNetworkChainId: number,
    label?: string
  ) => Promise<IKeyringAccountState>;
  createWallet: (password: string, phrase: string) => Promise<void>;
  editAccountLabel: (
    label: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => void;
  editCustomRpc: (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ) => Promise<INetwork>;
  forgetWallet: (pwd: string) => void;
  getChangeAddress: (accountId: number) => Promise<string>;
  getLatestUpdateForCurrentAccount: () => void;
  getRecommendedFee: (data?: string | boolean) =>
    | Promise<number>
    | Promise<
        | string
        | {
            ethers: string;
            gwei: string;
          }
      >;
  getRpc: (data: ICustomRpcParams) => Promise<INetwork>;
  importAccountFromPrivateKey: (
    privKey: string,
    label?: string
  ) => Promise<IKeyringAccountState>;
  // importTrezorAccount: (
  //   coin: string,
  //   slip44: string,
  //   index: string
  // ) => Promise<IKeyringAccountState>;
  lock: () => void;
  removeKeyringNetwork: (chain: string, chainId: number, key?: string) => void;
  removeWindowEthProperty: () => void;
  resolveAccountConflict: () => void;
  resolveError: () => void;
  sendAndSaveTransaction: (
    tx: IEvmTransactionResponse | ISysTransaction
  ) => void;
  setAccount: (
    id: number,
    type: KeyringAccountType,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ) => void;
  setActiveNetwork: (network: INetwork, chain: string) => Promise<any>;
  setAdvancedSettings: (advancedProperty: string, isActive: boolean) => void;
  setAutolockTimer: (minutes: number) => void;
  setHasEthProperty: (exist: boolean) => void;
  setIsAutolockEnabled: (isEnabled: boolean) => void;
  transactions: ITransactionsManager;
  unlock: (pwd: string) => Promise<boolean>;
  unlockFromController: (pwd: string) => Promise<boolean>;
  updateAssetsFromCurrentAccount: ({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
    isPolling,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling: boolean;
  }) => void;
  updateUserNativeBalance: ({
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
  }) => void;
  updateUserTransactionsState: ({
    isPolling,
    isBitcoinBased,
    activeNetwork,
    activeAccount,
  }: {
    activeAccount: {
      id: number;
      type: KeyringAccountType;
    };
    activeNetwork: INetwork;
    isBitcoinBased: boolean;
    isPolling: boolean;
  }) => void;
}

export interface IEthTokenDetails {
  contract: string;
  decimals: number;
  description: string;
  id: string;
  name: string;
  symbol: string;
}

export interface IControllerUtils {
  getAsset: (
    explorerUrl: string,
    assetGuid: string
  ) => Promise<{
    assetGuid: string;
    contract: string;
    decimals: number;
    maxSupply: string;
    pubData: any;
    symbol: string;
    totalSupply: string;
    updateCapabilityFlags: number;
  }>;
  // eslint-disable-next-line @typescript-eslint/ban-types
  getFeeRate: (fee: number) => BigInt;
  getPsbtFromJson: (psbt: JSON) => string;
  getRawTransaction: (explorerUrl: string, txid: string) => any;
  getSearch: (query: string) => Promise<ICoingeckoSearchResults>;
  getToken: (tokenId: string) => Promise<ICoingeckoToken>;
  getTokenByContract: (contractAddress: string) => Promise<ICoingeckoToken>;
  getTokenJson: () => {
    address: string;
    chainId: number;
    decimals: number;
    logoURI: string;
    name: string;
    symbol: string;
  }[];
  getTokenMap: ({
    guid,
    changeAddress,
    amount,
    receivingAddress,
  }: {
    amount: number;
    changeAddress: string;
    guid: number | string;
    receivingAddress: string;
  }) => ITokenMap;
  isValidEthereumAddress: (value: string, activeNetwork: INetwork) => boolean;
  isValidSYSAddress: (
    address: string,
    purpose: number,
    verification?: boolean
  ) => boolean;
  setFiat: (currency?: string, assetId?: string) => Promise<void>;
}

export interface IDAppController {
  /**
   * Changes the account
   * @emits accountsChanged
   */
  changeAccount: (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => void;
  /**
   * Completes a connection with a DApp
   * @emits connect
   */
  connect: (dapp: IDApp, isDappConnected?: boolean) => void;
  /**
   * Removes a connection with a DApp
   * @emits disconnect
   */
  disconnect: (host: string) => void;
  /**
   * Retrieves a DApp
   */
  get: (host: string) => IDApp | undefined;
  /**
   * Retrieves the connected account
   */
  getAccount: (host: string) => IOmmitedAccount;
  getAll: () => { [host: string]: IDApp };
  getNetwork: () => INetwork;
  getState: () => any;
  /**
   * Changes the active network
   */
  // changeActiveBlockExplorer: (blockExplorer: string) => void;
  /**
   * Update state and emit events to all connected dApps
   * @emits PaliSyscoinEvents
   */
  handleBlockExplorerChange: (
    id: PaliSyscoinEvents,
    data: { method: string; params: any }
  ) => Promise<void>;

  /**
   * Changes the active network
   */
  // changeNetwork: (chainId: number) => void;
  /**
   * Update state and emit events to all connected dApps
   * @emits PaliEvents
   */
  handleStateChange: (
    id: PaliEvents,
    data: { method: string; params: any }
  ) => Promise<void>;
  /**
   * Checks if DApp has an open popup
   */
  hasWindow: (host: string) => boolean;
  /**
   * Checks if DApp is listed
   */
  isConnected: (host: string) => boolean;
  /**
   * If connected changes account granting permissions by EIP2255 reference
   * @emits requestPermissions
   */
  requestPermissions: (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => void;
  /**
   * Sets whether a DApp has an open popup
   */
  setHasWindow: (host: string, hasWindow: boolean) => void;

  /**
   * Setup communication
   */
  setup: (port: Runtime.Port) => void;
}
