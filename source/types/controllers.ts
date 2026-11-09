import {
  PaliEvents,
  PaliSyscoinEvents,
} from 'scripts/Background/controllers/message-handler/types';
import { IDApp } from 'state/dapp/types';
import { IOmmitedAccount } from 'state/vault/types';
import { KeyringAccountType, INetwork } from 'types/network';

export type { DappAccountSelection as IDAppAccountSelectionContext } from '../shared/dappTypes';
import type { DappAccountSelection } from '../shared/dappTypes';

export interface IDAppController {
  /** Internal retirement of the sessions captured for one removed account. */
  captureAccountSessionRetirement: (
    accountId: number,
    accountType: KeyringAccountType
  ) => { grants: IDApp[]; retire: () => void };
  /** Internal, irreversible ownership of the exact originating grant. */
  captureApproval: (origin: string) => () => void;
  /**
   * Changes the account
   * @emits accountsChanged
   */
  changeAccount: (
    host: string,
    accountId: number,
    accountType: KeyringAccountType,
    expectedContext: DappAccountSelection,
    stageReplacement?: (grant: IDApp) => void
  ) => Promise<void>;
  /**
   * Completes a connection with a DApp
   * @emits connect
   */
  connect: (
    dapp: IDApp,
    expectedContext: DappAccountSelection
  ) => Promise<void>;
  /**
   * Retrieves a DApp
   */
  get: (host: string) => IDApp | undefined;
  /**
   * Retrieves the connected account
   */
  getAccount: (host: string) => IOmmitedAccount | null;
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
    expectedContext: DappAccountSelection
  ) => Promise<any[]>;
  /** Clear runtime sessions and notify prior origins after a committed forget. */
  resetSessions: (previousOrigins: string[]) => Promise<void>;
  /** The owning account/network transaction persists this permission removal. */
  retireForTransaction: (host: string) => void;
  /**
   * Removes a connection with a DApp
   * @emits disconnect
   */
  revoke: (
    host: string,
    options: Readonly<{ allowAlreadyDisconnected: boolean }>
  ) => Promise<void>;
  /**
   * Sets whether a DApp has an open popup
   */
  setHasWindow: (host: string, hasWindow: boolean) => void;
  /**
   * Setup communication
   */
  setup: (sender: chrome.runtime.MessageSender) => void;
}

export interface IEventData {
  detail?: string;
  eventName: string;
}

export interface ICustomEvent {
  data: IEventData;
}
