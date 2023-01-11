import { ConsoleSqlOutlined } from '@ant-design/icons';
import { EventEmitter } from 'events';
import dequal from 'fast-deep-equal';

import { isNFT as _isNFT } from '@pollum-io/sysweb3-utils';

import messages from './messages';
import {
  EMITTED_NOTIFICATIONS,
  getRpcPromiseCallback,
  isValidChainId,
  isValidNetworkVersion,
  NOOP,
} from './utils';
export type Maybe<T> = Partial<T> | null | undefined;
type WarningEventName = keyof SentWarningsState['events'];
export declare type JsonRpcVersion = '2.0';
// eslint-disable-next-line @typescript-eslint/naming-convention
interface SentWarningsState {
  // methods
  disable: boolean;
  enable: boolean;
  // events
  events: {
    close: boolean;
    data: boolean;
    networkChanged: boolean;
    notification: boolean;
  };
  // methods
  experimentalMethods: boolean;
  send: boolean;
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BaseProviderState {
  accounts: null | string[];
  initialized: boolean;
  isConnected: boolean;
  isPermanentlyDisconnected: boolean;
  isUnlocked: boolean;
}
// eslint-disable-next-line @typescript-eslint/naming-convention
interface RequestArguments {
  /** The RPC method to request. */
  method: string;

  /** The params of the RPC method, if any. */
  params?: unknown[] | Record<string, unknown>;
}

interface SendSyncJsonRpcRequest {
  id: any;
  jsonrpc: any;
  method:
    | 'eth_accounts'
    | 'eth_coinbase'
    | 'eth_uninstallFilter'
    | 'net_version';
}
interface JsonRpcSuccessStruct {
  id: number;
  jsonrpc: JsonRpcVersion;
  result: any;
}

/**
 * A successful JSON-RPC response object.
 */

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface UnvalidatedJsonRpcRequest {
  id?: number;
  method: string;
  params?: unknown;
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface EnableLegacyPali {
  chain: string;
  chainId?: unknown;
}
//TODO: switch to SafeEventEmitter
export class PaliInpageProvider extends EventEmitter {
  public readonly _metamask: ReturnType<
    PaliInpageProvider['_getExperimentalApi']
  >;
  public readonly _sys: ReturnType<PaliInpageProvider['_getSysAPI']>;
  public chainType: string;
  public networkVersion: string | null;
  public chainId: string | null;
  public selectedAddress: string | null;
  public wallet: string;
  private static _defaultState: BaseProviderState = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };
  private _state: BaseProviderState;
  private _sentWarnings: SentWarningsState = {
    // methods
    enable: false,
    disable: false,
    experimentalMethods: false,
    send: false,
    // events
    events: {
      close: false,
      data: false,
      networkChanged: false,
      notification: false,
    },
  };

  /**
   * Indicating that this provider is a MetaMask provider.
   */
  public readonly isMetaMask: boolean = true;
  public readonly version: number | null = null;
  constructor(chainType, maxEventListeners = 100, wallet = 'pali-v2') {
    super();
    this.setMaxListeners(maxEventListeners);
    // Private state
    this._state = {
      ...PaliInpageProvider._defaultState,
    };
    if (chainType === 'syscoin') {
      //TODO: in case of syscoin chain nulify ethereum variables
      this.isMetaMask = false;
      this.version = 2;
    }
    // Public state
    this.selectedAddress = null;
    this.chainId = null;
    this.wallet = wallet;
    this._state;
    this.chainType = chainType;
    if (chainType !== 'syscoin') this._metamask = this._getExperimentalApi();
    if (chainType === 'syscoin') this._sys = this._getSysAPI();
    this.isUnlocked = this.isUnlocked.bind(this);
    this._handleAccountsChanged = this._handleAccountsChanged.bind(this);
    this._handleConnect = this._handleConnect.bind(this);
    this._handleChainChanged = this._handleChainChanged.bind(this);
    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleUnlockStateChanged = this._handleUnlockStateChanged.bind(this);
    this._rpcRequest = this._rpcRequest.bind(this);
    this.request = this.request.bind(this);
    this._sendSync = this._sendSync.bind(this);
    this.send = this.send.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this.request({ method: 'wallet_getProviderState' })
      .then((state) => {
        const initialState = state as Parameters<
          PaliInpageProvider['_initializeState']
        >[0];
        this._initializeState(initialState);
      })
      .catch((error) =>
        console.error(
          'Pali: Failed to get initial state. Please report this bug.',
          error
        )
      );

    window.addEventListener(
      'notification',
      (event: any) => {
        const { method, params } = JSON.parse(event.detail);
        console.log('Received new message', method, params);
        switch (method) {
          case 'pali_accountsChanged':
            this._handleAccountsChanged(params);
            break;
          case 'pali_unlockStateChanged':
            console.log('Received event');
            this._handleUnlockStateChanged(params);
            break;
          case 'pali_chainChanged':
            this._handleChainChanged(params);
            break;
          case EMITTED_NOTIFICATIONS.includes(method):
            //TODO: implement subscription messages
            throw {
              code: 69,
              message: 'Pali: Does not yet have subscription to rpc methods',
            };
          default:
            this._handleDisconnect(
              false,
              messages.errors.permanentlyDisconnected()
            );
        }
      },
      {
        passive: true,
      }
    );
  }

  //====================
  // Public Methods
  //====================

  /**
   * Returns whether the provider can process RPC requests.
   */
  isConnected(): boolean {
    return this._state.isConnected;
  }
  /**
   * Submits an RPC request for the given method, with the given params.
   * Resolves with the result of the method call, or rejects on error.
   *
   * @param args - The RPC request arguments.
   * @param args.method - The RPC method name.
   * @param args.params - The parameters for the RPC method.
   * @returns A Promise that resolves with the result of the RPC method,
   * or rejects if an error is encountered.
   */
  public async request<T>(args: RequestArguments): Promise<Maybe<T>> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw messages.errors.invalidRequestArgs();
    }

    const { method, params } = args;

    if (typeof method !== 'string' || method.length === 0) {
      throw messages.errors.invalidRequestMethod();
    }

    if (
      params !== undefined &&
      !Array.isArray(params) &&
      (typeof params !== 'object' || params === null)
    ) {
      throw messages.errors.invalidRequestParams();
    }

    return new Promise<T>((resolve, reject) => {
      this._rpcRequest(
        { method, params },
        getRpcPromiseCallback(resolve, reject, false)
      );
    });
  }

  sendAsync(
    payload: any,
    callback: (error: Error | null, result?: any) => void
  ): void {
    this._rpcRequest(payload, callback);
  }

  send(methodOrPayload: unknown, callbackOrArgs?: unknown): unknown {
    if (!this._sentWarnings.send) {
      console.warn(messages.warnings.sendDeprecation);
      this._sentWarnings.send = true;
    }

    if (
      typeof methodOrPayload === 'string' &&
      (!callbackOrArgs || Array.isArray(callbackOrArgs))
    ) {
      return new Promise((resolve, reject) => {
        try {
          this._rpcRequest(
            { method: methodOrPayload, params: callbackOrArgs },
            getRpcPromiseCallback(resolve, reject, false)
          );
        } catch (error) {
          reject(error);
        }
      });
    } else if (
      methodOrPayload &&
      typeof methodOrPayload === 'object' &&
      typeof callbackOrArgs === 'function'
    ) {
      return this._rpcRequest(
        methodOrPayload as UnvalidatedJsonRpcRequest,
        callbackOrArgs as (...args: unknown[]) => void
      );
    }
    return this._sendSync(methodOrPayload as SendSyncJsonRpcRequest);
  }

  /**
   * Internal backwards compatibility method, used in send.
   *
   * @deprecated
   */
  private _sendSync(payload: SendSyncJsonRpcRequest) {
    let result;
    switch (payload.method) {
      case 'eth_accounts':
        result = this.selectedAddress ? [this.selectedAddress] : [];
        break;

      case 'eth_coinbase':
        result = this.selectedAddress || null;
        break;

      case 'eth_uninstallFilter':
        this._rpcRequest(payload, NOOP);
        result = true;
        break;

      case 'net_version':
        result = this.networkVersion || null;
        break;

      default:
        throw new Error(messages.errors.unsupportedSync(payload.method));
    }

    return {
      id: payload.id,
      jsonrpc: payload.jsonrpc,
      result,
    };
  }

  //TODO: properly deprecate enable and change implementation on background of it
  /**
   * Equivalent to: ethereum.request('eth_requestAccounts')
   *
   * @deprecated
   * @returns A promise that resolves to an array of addresses.
   */
  public async enable(): Promise<string[]> {
    if (!this._sentWarnings.enable) {
      console.warn(messages.warnings.enableDeprecation);
      this._sentWarnings.enable = true;
    }

    return new Promise<string[]>(async (resolve, reject) => {
      try {
        const acc: string[] = (await this.proxy('ENABLE', {
          chain: this.chainType,
          chainId: this.chainType === 'ethereum' ? '0x01' : '0x57',
        })) as string[];
        resolve(acc);
      } catch (error) {
        reject(error);
      }
    });
  }
  /**
   * TODO: properly deprecate disable and change implementation on background of it
   * @deprecated
   * @returns A promise that resolves to an array of addresses.
   */
  public async disable(): Promise<string[]> {
    if (!this._sentWarnings.disable) {
      console.warn(messages.warnings.enableDeprecation);
      this._sentWarnings.enable = true;
    }
    return new Promise<string[]>(async (resolve, reject) => {
      try {
        const acc: string[] = (await this.proxy('DISABLE', {
          chain: this.chainType,
          chainId: this.chainType === 'ethereum' ? '0x01' : '0x57',
        })) as string[];
        resolve(acc);
      } catch (error) {
        reject(error);
      }
    });
  }

  public async isUnlocked(): Promise<boolean> {
    if (!this._state.initialized) {
      await new Promise<void>((resolve) => {
        this.on('_initialized', () => resolve());
      });
    }
    return this._state.isUnlocked;
  }
  //====================
  // Private Methods
  //====================

  /**
   *
   * Sets initial state if provided and marks this provider as initialized.
   * Throws if called more than once.
   *
   * @param initialState - The provider's initial state.
   * @emits BaseProvider#_initialized
   * @emits BaseProvider#connect - If `initialState` is defined.
   */
  private _initializeState(initialState?: {
    accounts: string[];
    chainId: string;
    isUnlocked: boolean;
    networkVersion?: string;
  }) {
    if (this._state.initialized === true) {
      throw new Error('Provider already initialized.');
    }

    if (initialState) {
      const { accounts, chainId, isUnlocked, networkVersion } = initialState;

      // EIP-1193 connect
      this._handleConnect(chainId);
      this._handleChainChanged({ chainId, networkVersion });
      this._handleUnlockStateChanged({ accounts, isUnlocked });
      this._handleAccountsChanged(accounts);
    }

    // Mark provider as initialized regardless of whether initial state was
    // retrieved.
    this._state.initialized = true;
    this.emit('_initialized');
  }
  private async _rpcRequest(
    payload: UnvalidatedJsonRpcRequest | UnvalidatedJsonRpcRequest[], //TODO: refactor to accept incoming batched requests
    callback: (...args: any[]) => void
  ) {
    let cb = callback;
    let error = null;
    let result = null;
    let formatedResult = null;
    if (!Array.isArray(payload)) {
      if (
        payload.method === 'eth_requestAccounts' ||
        payload.method === 'eth_accounts'
      ) {
        // handle accounts changing
        cb = (err: Error, res: JsonRpcSuccessStruct) => {
          this._handleAccountsChanged(
            res?.result || [],
            payload.method === 'eth_accounts'
          );
          callback(err, res);
        };
      }

      try {
        result = await this.proxy('METHOD_REQUEST', payload);
        formatedResult = {
          id: payload.id || 1,
          jsonrpc: '2.0' as JsonRpcVersion,
          result: result,
        };
      } catch (_error) {
        // A request handler error, a re-thrown middleware error, or something
        // unexpected.
        error = _error;
      }
      return cb(error, formatedResult);
    }
    error = {
      code: 123,
      message: messages.errors.invalidBatchRequest(),
      data: null,
    };
    return callback(error, result);
  }
  private proxy = (
    type: string,
    data: UnvalidatedJsonRpcRequest | EnableLegacyPali
  ) =>
    new Promise((resolve, reject) => {
      const id = Date.now() + '.' + Math.random();

      window.addEventListener(
        id,
        (event: any) => {
          if (event.detail === undefined) {
            resolve(undefined);
            return;
          } else if (event.detail === null) {
            resolve(null);
            return;
          }

          const response = JSON.parse(event.detail);
          if (response.error) {
            reject(response.error);
          }
          resolve(response);
        },
        {
          once: true,
          passive: true,
        }
      );
      window.postMessage(
        {
          id,
          type,
          data,
        },
        '*'
      );
    });

  private _handleAccountsChanged(
    accounts: unknown[],
    isEthAccounts = false
  ): void {
    let _accounts = accounts;

    if (!Array.isArray(accounts)) {
      console.error(
        'Pali: Received invalid accounts parameter. Please report this bug.',
        accounts
      );
      _accounts = [];
    }

    for (const account of accounts) {
      if (typeof account !== 'string' && account !== null) {
        console.error(
          'Pali: Received non-string account. Please report this bug.',
          accounts
        );
        _accounts = [];
        break;
      }
    }

    // emit accountsChanged if anything about the accounts array has changed
    if (!dequal(this._state.accounts, _accounts)) {
      // we should always have the correct accounts even before eth_accounts
      // returns
      if (
        isEthAccounts &&
        this._state.accounts !== null &&
        this._state.accounts.length !== 0
      ) {
        console.error(
          `Pali: 'eth_accounts' unexpectedly updated accounts. Please report this bug.`,
          _accounts
        );
      }

      this._state.accounts = _accounts as string[];

      // handle selectedAddress
      if (this.selectedAddress !== _accounts[0]) {
        this.selectedAddress = (_accounts[0] as string) || null;
      }

      // finally, after all state has been updated, emit the event
      if (this._state.initialized) {
        this.emit('accountsChanged', _accounts);
      }
    }
  }
  /**
   * When the provider becomes connected, updates internal state and emits
   * required events. Idempotent.
   *
   * @param chainId - The ID of the newly connected chain.
   * @emits PaliInpageProvider#connect
   */
  private _handleConnect(chainId: string) {
    if (!this._state.isConnected) {
      this._state.isConnected = true;
      this.emit('connect', { chainId });
      console.debug(messages.info.connected(chainId));
    }
  }

  /**
   * Upon receipt of a new `chainId`, emits the corresponding event and sets
   * and sets relevant public state. Does nothing if the given `chainId` is
   * equivalent to the existing value.
   *
   * Permits the `networkVersion` field in the parameter object for
   * compatibility with child classes that use this value.
   *
   * @emits BaseProvider#chainChanged
   * @param networkInfo - An object with network info.
   * @param networkInfo.chainId - The latest chain ID.
   */
  private _handleChainChanged({
    chainId,
    networkVersion,
  }: { chainId?: string; networkVersion?: string } = {}) {
    if (!isValidChainId(chainId) || !isValidNetworkVersion(networkVersion)) {
      console.error(messages.errors.invalidNetworkParams(), {
        chainId,
        networkVersion,
      });
      return;
    }
    if (networkVersion === 'loading') {
      this._handleDisconnect(true);
      return;
    }

    this._handleConnect(chainId);

    if (chainId !== this.chainId) {
      this.chainId = chainId;
      this.networkVersion = networkVersion;
      if (this._state.initialized) {
        this.emit('chainChanged', this.chainId);
      }
    }
  }

  /**
   * When the provider becomes disconnected, updates internal state and emits
   * required events. Idempotent with respect to the isRecoverable parameter.
   *
   * Error codes per the CloseEvent status codes as required by EIP-1193:
   * https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes
   *
   * @param isRecoverable - Whether the disconnection is recoverable.
   * @param errorMessage - A custom error message.
   * @emits BaseProvider#disconnect
   */
  private _handleDisconnect(isRecoverable: boolean, errorMessage?: string) {
    if (
      this._state.isConnected ||
      (!this._state.isPermanentlyDisconnected && !isRecoverable)
    ) {
      this._state.isConnected = false;

      let error;
      if (isRecoverable) {
        error = {
          code: 1013, // Try again later
          message: errorMessage || messages.errors.disconnected(),
        };
        console.debug(error);
      } else {
        error = {
          code: 1011, // Internal error
          message: errorMessage || messages.errors.permanentlyDisconnected(),
        };
        console.error(error);
        this.chainId = null;
        this.networkVersion = null;
        this._state.accounts = null;
        this.selectedAddress = null;
        this._state.isUnlocked = false;
        this._state.isPermanentlyDisconnected = true;
      }

      this.emit('disconnect', error);
    }
  }
  /**
   * Upon receipt of a new isUnlocked state, sets relevant public state.
   * Calls the accounts changed handler with the received accounts, or an empty
   * array.
   *
   * Does nothing if the received value is equal to the existing value.
   * There are no lock/unlock events.
   *
   * @param opts - Options bag.
   * @param opts.accounts - The exposed accounts, if any.
   * @param opts.isUnlocked - The latest isUnlocked value.
   */
  private _handleUnlockStateChanged({
    accounts,
    isUnlocked,
  }: { accounts?: string[]; isUnlocked?: boolean } = {}) {
    console.log('Oh bracket jesus', isUnlocked);
    if (typeof isUnlocked !== 'boolean') {
      console.error(
        'Pali: Received invalid isUnlocked parameter. Please report this bug.'
      );
      return;
    }

    if (isUnlocked !== this._state.isUnlocked) {
      console.log('Changing lockState', isUnlocked);
      this._state.isUnlocked = isUnlocked;
      console.log('Changing lockState', this._state.isUnlocked);
      this._handleAccountsChanged(accounts || []);
    }
  }
  private _warnOfDeprecation(eventName: string): void {
    if (this._sentWarnings?.events[eventName as WarningEventName] === false) {
      console.warn(messages.warnings.events[eventName as WarningEventName]);
      this._sentWarnings.events[eventName as WarningEventName] = true;
    }
  }

  private _getExperimentalApi() {
    return new Proxy(
      {
        /**
         * Determines if Pali is unlocked by the user.
         *
         * @returns Promise resolving to true if Pali is currently unlocked
         */
        isUnlocked: async () => {
          if (!this._state.initialized) {
            await new Promise<void>((resolve) => {
              this.on('_initialized', () => resolve());
            });
          }
          return this._state.isUnlocked;
        },
      },
      {
        get: (obj, prop, ...args) => Reflect.get(obj, prop, ...args),
      }
    );
  }

  private _getSysAPI() {
    return new Proxy(
      {
        /**
         * Determines if Pali is unlocked by the user.
         *
         * @returns Promise resolving to true if Pali is currently unlocked
         */
        isNFT: (guid: number) => {
          const validated = _isNFT(guid);
          return validated;
        },
      },
      {
        get: (obj, prop, ...args) => Reflect.get(obj, prop, ...args),
      }
    );
  }
}
