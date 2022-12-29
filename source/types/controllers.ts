import { Runtime } from 'webextension-polyfill-ts';

import {
  IKeyringManager,
  IKeyringAccountState,
} from '@pollum-io/sysweb3-keyring';
import {
  INetwork,
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { IEthAccountController } from 'scripts/Background/controllers/account/evm';
import { ISysAccountController } from 'scripts/Background/controllers/account/syscoin';
import { DAppEvents } from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';

import { ICustomRpcParams } from './transactions';

export interface IMainController extends IKeyringManager {
  account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  addCustomRpc: (rpc: any) => Promise<any>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: (password: string) => Promise<any>;
  editCustomRpc: (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ) => Promise<INetwork>;
  forgetWallet: (pwd: string) => void;
  getNetworkData: () => Promise<{ chainId: string; networkVersion: string }>;
  getRecommendedFee: (data?: string | boolean) => number;
  lock: () => void;
  removeKeyringNetwork: (chain: string, chainId: number) => void;
  resolveError: () => void;
  setAccount: (id: number) => void;
  setActiveNetwork: (network: INetwork, chain: string) => Promise<any>;
  setAutolockTimer: (minutes: number) => void;
  unlock: (pwd: string) => Promise<void>;
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
  appRoute: (newRoute?: string, external?: boolean) => string;
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
  getGasUsedInTransaction: (transactionHash: string) => Promise<{
    effectiveGasPrice: number;
    gasUsed: number;
  }>;
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
    activeNetwork: INetwork,
    verification?: boolean
  ) => boolean;
  setFiat: (currency?: string, assetId?: string) => Promise<void>;
}

export interface IDAppController {
  /**
   * Adds an event listener
   */
  addListener: (host: string, eventName: string) => void;
  /**
   * Changes the account
   * @emits accountsChanged
   */
  changeAccount: (host: string, accountId: number) => void;
  /**
   * Changes the active network
   */
  changeNetwork: (chainId: number) => void;
  /**
   * Completes a connection with a DApp
   * @emits connect
   */
  connect: (dapp: IDApp) => void;
  /**
   * Removes a connection with a DApp
   * @emits disconnect
   */
  disconnect: (host: string) => void;
  /**
   * Dispatch an event to all dapps
   */
  dispatchEvent: (event: DAppEvents, data: any) => void;
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
   * Checks if listener exists
   */
  hasListener: (host: string, eventName: string) => boolean;
  /**
   * Checks if DApp has an open popup
   */
  hasWindow: (host: string) => boolean;
  /**
   * Checks if DApp is listed
   */
  isConnected: (host: string) => boolean;
  /**
   * Removes an event listener
   */
  removeListener: (host: string, eventName: string) => void;
  /**
   * Removes all listeners from a DApp
   */
  removeListeners: (host: string) => void;
  /**
   * If connected changes account granting permissions by EIP2255 reference
   * @emits requestPermissions
   */
  requestPermissions: (host: string, accountId: number) => void;
  /**
   * Sets whether a DApp has an open popup
   */
  setHasWindow: (host: string, hasWindow: boolean) => void;

  /**
   * Setup communication
   */
  setup: (port: Runtime.Port) => void;
}
