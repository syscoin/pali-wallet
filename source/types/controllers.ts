import { Runtime } from 'webextension-polyfill-ts';

import {
  IKeyringAccountState,
  INetwork,
  KeyringManager,
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { ISigRequest } from 'scripts/Background/controllers/DAppController';
import { IDApp } from 'state/dapp/types';

export interface IMainController extends KeyringManager {
  account: any;
  addCustomRpc: (network: INetwork) => Promise<INetwork | Error>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: () => Promise<IKeyringAccountState>;
  forgetWallet: (pwd: string) => void;
  lock: () => void;
  setAccount: (id: number) => void;
  setActiveNetwork: (
    chain: string,
    chainId: number
  ) => Promise<IKeyringAccountState>;
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
   * Adds the DApp to the store without an account
   */
  addDApp: (port: Runtime.Port) => void;
  /**
   * Adds an event listener
   */
  addListener: (host: string, eventName: string) => void;
  /**
   * Changes the account
   * @emits accountChange
   */
  changeAccount: (host: string, accountId: number) => void;
  /**
   * Complete a connection with a DApp. Adds the account
   * @emits connect
   */
  connect: (host: string, accountId: number) => void;
  /**
   * Removes a connection with a DApp. Removes the account
   * @emits disconnect
   */
  disconnect: (host: string) => void;
  /**
   * Retrieves the connected account
   */
  getAccount: (host: string) => IKeyringAccountState | undefined;
  /**
   * Retrieves a DApp
   */
  getDApp: (host: string) => IDApp | undefined;
  getSigRequest: () => ISigRequest;
  /**
   * Checks if DApp exists
   */
  hasDApp: (host: string) => boolean;
  /**
   * Checks if listener exists
   */
  hasListener: (host: string, eventName: string) => boolean;
  /**
   * Checks if DApp has an open popup
   */
  hasWindow: (host: string) => boolean;
  /**
   * Checks if DApp has a connected account
   */
  isConnected: (host: string) => boolean;
  /**
   * Removes a DApp
   */
  removeDApp: (host: string) => void;
  /**
   * Removes an event listener
   */
  removeListener: (host: string, eventName: string) => void;
  /**
   * Removes all listeners from a DApp
   */
  removeListeners: (host: string) => void;
  setHasWindow: (host: string, hasWindow: boolean) => void;
  setSigRequest: (req: ISigRequest) => void;
}
