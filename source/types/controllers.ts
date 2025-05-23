import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { INetworkWithKind } from 'state/vault/types';
import { IOmmitedAccount } from 'state/vault/types';

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
  getNetwork: () => INetworkWithKind;
  getState: () => any;
  /**
   * Update state and emit events to all connected dApps
   * @emits PaliSyscoinEvents
   */
  handleBlockExplorerChange: (
    id: PaliSyscoinEvents,
    data: { method: string; params: any }
  ) => Promise<void>;

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

// eslint-disable-next-line no-shadow
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
