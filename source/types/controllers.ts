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
import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';

import { ICustomRpcParams } from './transactions';

export interface IMainController extends IKeyringManager {
  account: {
    eth: IEthAccountController;
    sys: ISysAccountController;
  };
  addCustomRpc: (rpc: ICustomRpcParams) => Promise<INetwork>;
  createAccount: (label?: string) => Promise<IKeyringAccountState>;
  createWallet: (password: string) => Promise<void>;
  editCustomRpc: (
    newRpc: ICustomRpcParams,
    oldRpc: ICustomRpcParams
  ) => Promise<INetwork>;
  forgetWallet: (pwd: string) => void;
  getChangeAddress: (accountId: number) => string;
  getNetworkData: () => Promise<{ chainId: string; networkVersion: string }>;
  getRecommendedFee: (data?: string | boolean) => Promise<number>;
  getRpc: (data: ICustomRpcParams) => Promise<INetwork>;
  lock: () => void;
  removeKeyringNetwork: (chain: string, chainId: number, key?: string) => void;
  resolveAccountConflict: () => void;
  resolveError: () => void;
  setAccount: (
    id: number,
    host?: string,
    connectedAccount?: IOmmitedAccount
  ) => void;
  setActiveNetwork: (network: INetwork, chain: string) => Promise<any>;
  setAutolockTimer: (minutes: number) => void;
  setIsPopupOpen: (isOpen: boolean) => void;
  unlock: (pwd: string) => Promise<void>;
  updateErcTokenBalances: (
    accountId: number,
    tokenAddress: string,
    tokenChain: number,
    isNft: boolean,
    decimals?: number
  ) => Promise<void>;
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
   * Changes the account
   * @emits accountsChanged
   */
  changeAccount: (host: string, accountId: number) => void;
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
