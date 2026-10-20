import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';
import { KeyringAccountType, INetwork } from 'types/network';

export interface IDAppDisconnectOptions {
  allowAlreadyDisconnected?: boolean;
  propagateErrors?: boolean;
}

/** Public identity reviewed by an account-permission approval. */
export interface IDAppAccountSelectionContext {
  address: string;
  network: Pick<INetwork, 'chainId' | 'kind' | 'slip44' | 'url'>;
  xpub?: string;
}

export interface IDAppController {
  /** Internal retirement of the sessions captured for one removed account. */
  captureAccountSessionRetirement: (
    accountId: number,
    accountType: KeyringAccountType
  ) => { grants: IDApp[]; retire: () => void };
  /**
   * Changes the account
   * @emits accountsChanged
   */
  changeAccount: (
    host: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext
  ) => Promise<void>;
  /**
   * Completes a connection with a DApp
   * @emits connect
   */
  connect: (
    dapp: IDApp,
    expectedContext: IDAppAccountSelectionContext
  ) => Promise<void>;
  /**
   * Removes a connection with a DApp
   * @emits disconnect
   */
  disconnect: (
    host: string,
    persist?: boolean,
    options?: IDAppDisconnectOptions
  ) => Promise<void>;
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
    accountType: KeyringAccountType,
    expectedContext?: IDAppAccountSelectionContext
  ) => Promise<any[]>;
  /** Clear runtime sessions and notify prior origins after a committed forget. */
  resetSessions: (previousOrigins: string[]) => Promise<void>;
  /**
   * Sets whether a DApp has an open popup
   */
  setHasWindow: (host: string, hasWindow: boolean) => void;
  /**
   * Setup communication
   */
  setup: (sender: chrome.runtime.MessageSender) => void;

  /**
   * Synchronizes persisted and in-memory dApp account state without emitting provider events.
   */
  syncAccountSession: (
    host: string,
    accountId: number,
    accountType: KeyringAccountType
  ) => void;
}

export interface IEventData {
  detail?: string;
  eventName: string;
}

export interface ICustomEvent {
  data: IEventData;
}
