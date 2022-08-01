import { Runtime } from 'webextension-polyfill-ts';

import { Web3Accounts } from '@pollum-io/sysweb3-keyring';
import { IKeyringManager } from '@pollum-io/sysweb3-keyring';
import {
  IKeyringAccountState,
  INetwork,
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import { ISysAccountController } from 'scripts/Background/controllers/account/syscoin';
import { ISigRequest } from 'scripts/Background/controllers/DAppController';
import { IDApp } from 'state/dapp/types';

import { ICustomRpcParams } from './transactions';

// TODO IWeb3Accounts
const web3Accounts = Web3Accounts();
type IWeb3Accounts = typeof web3Accounts;

export interface IMainController extends IKeyringManager {
  account: {
    eth: IWeb3Accounts;
    sys: ISysAccountController;
  };
  addCustomRpc: (rpc: ICustomRpcParams) => Promise<INetwork>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: () => Promise<IKeyringAccountState>;
  editCustomRpc: (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ) => Promise<INetwork>;
  forgetWallet: (pwd: string) => void;
  lock: () => void;
  removeKeyringNetwork: (chain: string, chainId: number) => void;
  setAccount: (id: number) => void;
  setActiveNetwork: (
    chain: string,
    chainId: number,
    key?: string | number
  ) => Promise<IKeyringAccountState>;
  setActiveTokenForWallet: () => Promise<void>;
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
