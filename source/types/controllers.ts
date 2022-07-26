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
  addDApp: (origin: string, title: string, port: Runtime.Port) => void;
  /**
   * Adds an event listener
   */
  addListener: (origin: string, eventName: string) => void;
  /**
   * Changes the account
   * @emits accountChange
   */
  changeAccount: (origin: string, accountId: number) => void;
  /**
   * Complete a connection with a DApp. Adds the account
   * @emits connect
   */
  connect: (origin: string, accountId: number) => void;
  /**
   * Removes a connection with a DApp. Removes the account
   * @emits disconnect
   */
  disconnect: (origin: string) => void;
  /**
   * Retrieves the connected account
   */
  getAccount: (origin: string) => IKeyringAccountState | undefined;
  /**
   * Retrieves a DApp
   */
  getDApp: (origin: string) => IDApp | undefined;
  getSigRequest: () => ISigRequest;
  /**
   * Checks if DApp exists
   */
  hasDApp: (origin: string) => boolean;
  /**
   * Checks if listener exists
   */
  hasListener: (origin: string, eventName: string) => boolean;
  /**
   * Checks if DApp has a connected account
   */
  isConnected: (origin: string) => boolean;
  /**
   * Removes a DApp
   */
  removeDApp: (origin: string) => void;
  /**
   * Removes an event listener
   */
  removeListener: (origin: string, eventName: string) => void;
  /**
   * Removes all listeners from a DApp
   */
  removeListeners: (origin: string) => void;
  setSigRequest: (req: ISigRequest) => void;
}
