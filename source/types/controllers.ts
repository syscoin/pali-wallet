import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';
import { INetwork } from '@pollum-io/sysweb3-network';
import {
  ITokenMap,
  ICoingeckoToken,
  ICoingeckoSearchResults,
} from '@pollum-io/sysweb3-utils';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';

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
  getFeeRate: (fee: number) => bigint;
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
  setup: (sender: chrome.runtime.MessageSender) => void;
}

export enum PaliRoutes {
  AddEthChain = 'add-EthChain',
  ChangeAccount = 'change-account',
  EncryptKey = 'tx/encryptKey',
  EthSign = 'tx/ethSign',
  SendApprove = 'tx/send/approve',
  SendEthTX = 'tx/send/ethTx',
  SendNTokenTX = 'tx/send/nTokenTx',
  SwitchEthChain = 'switch-EthChain',
  SwitchNetwork = 'switch-network',
  SwitchUtxo = 'switch-UtxoEvm',
  WatchAsset = 'watch-asset',
}

export interface IEventData {
  detail?: string;
  eventName: string;
}

export interface ICustomEvent {
  data: IEventData;
}
