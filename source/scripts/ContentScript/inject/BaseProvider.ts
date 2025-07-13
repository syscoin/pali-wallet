import { EventEmitter } from 'events';

import { INetworkType } from '@pollum-io/sysweb3-network';

import messages from './messages';
import { getRpcPromiseCallback } from './utils';
export type Maybe<T> = Partial<T> | null | undefined;
export declare type JsonRpcVersion = '2.0';
export type WarningEventName = keyof SentWarningsState['events'];
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
export interface RequestArguments {
  /** The RPC method to request. */
  method: string;

  /** The params of the RPC method, if any. */
  params?: unknown[] | Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface JsonRpcSuccessStruct {
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
  chain: INetworkType;
  chainId?: unknown;
}
//TODO: switch to SafeEventEmitter
export class BaseProvider extends EventEmitter {
  public wallet: string;
  public chainType: INetworkType;
  private _networkStateCache: {
    isBitcoinBased?: boolean;
    timestamp?: number;
  } = {};
  private static readonly CACHE_TTL = 5000; // 5 seconds cache

  // Enhanced caching for provider state - separate caches for different methods
  private _providerStateCache: {
    [method: string]: {
      data?: any;
      isValid?: boolean;
      timestamp?: number;
    };
  } = {};
  private static readonly PROVIDER_STATE_CACHE_TTL = 10000; // 10 seconds cache for provider state
  private static readonly CONNECTION_ERROR_CACHE_TTL = 2000; // 2 seconds cache for connection errors

  // Connection state tracking
  private _isBackgroundConnected = true;
  private _lastConnectionError = 0;
  protected _sentWarnings: SentWarningsState = {
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
  constructor(chainType, maxEventListeners = 100, wallet = 'pali-v2') {
    super();
    this.setMaxListeners(maxEventListeners);
    // Public state
    this.chainType = chainType;
    this._rpcRequest = this._rpcRequest.bind(this);
    this.request = this.request.bind(this);
    this.wallet = wallet;

    // Listen for network changes to clear cache
    this._setupNetworkChangeListener();
  }

  /**
   * Sets up listener for network change events to clear the cache
   */
  private _setupNetworkChangeListener(): void {
    // Listen for chainChanged events which are emitted when network changes
    this.on('chainChanged', () => {
      // Clear both network state cache and provider state cache when network changes
      this._networkStateCache = {};
      this._providerStateCache = {};
      console.log('[BaseProvider] Network changed, caches cleared');
    });

    // Also listen for disconnect events to invalidate caches
    this.on('disconnect', () => {
      this._providerStateCache = {};
      this._isBackgroundConnected = false;
      this._lastConnectionError = Date.now();
      console.log('[BaseProvider] Disconnected, caches invalidated');
    });
  }

  //====================
  // Public Methods
  //====================

  /**
   * Gets the current network type from the wallet
   * Uses caching to avoid excessive RPC calls
   */
  private async getNetworkType(): Promise<boolean> {
    const now = Date.now();

    // Check cache first
    if (
      this._networkStateCache.isBitcoinBased !== undefined &&
      this._networkStateCache.timestamp &&
      now - this._networkStateCache.timestamp < BaseProvider.CACHE_TTL
    ) {
      return this._networkStateCache.isBitcoinBased;
    }

    // 🔥 FIX: Try getSysProviderState first (works on all networks)
    // If it fails, then try getProviderState (EVM only)
    try {
      const sysProviderState = (await this.proxy('METHOD_REQUEST', {
        method: 'wallet_getSysProviderState',
        params: [],
      })) as any;

      if (
        sysProviderState &&
        typeof sysProviderState.isBitcoinBased === 'boolean'
      ) {
        // Update cache
        this._networkStateCache = {
          isBitcoinBased: sysProviderState.isBitcoinBased,
          timestamp: now,
        };
        return sysProviderState.isBitcoinBased;
      }
    } catch (sysError) {
      // If getSysProviderState fails, try getProviderState (EVM networks)
      try {
        const providerState = (await this.proxy('METHOD_REQUEST', {
          method: 'wallet_getProviderState',
          params: [],
        })) as any;

        if (
          providerState &&
          typeof providerState.isBitcoinBased === 'boolean'
        ) {
          // Update cache
          this._networkStateCache = {
            isBitcoinBased: providerState.isBitcoinBased,
            timestamp: now,
          };
          return providerState.isBitcoinBased;
        }
      } catch (providerError) {
        console.warn('Failed to determine network type:', providerError);
      }
    }

    // Default based on the provider type
    // If this is a Syscoin provider, default to bitcoin-based (true)
    // If this is an Ethereum provider, default to EVM (false)
    const defaultValue = this.chainType === INetworkType.Syscoin;

    // Cache the default value to avoid repeated failures
    this._networkStateCache = {
      isBitcoinBased: defaultValue,
      timestamp: now,
    };

    return defaultValue;
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

    // 🔥 REMOVED: Don't block EVM methods here - let the background pipeline handle network switching
    // The pipeline will detect network mismatches and prompt the user to switch networks
    // This provides a much better UX than just throwing an error

    return new Promise<T>((resolve, reject) => {
      this._rpcRequest(
        { method, params },
        getRpcPromiseCallback(resolve, reject)
      );
    });
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

  //====================
  // Private Methods
  //====================
  protected _warnOfDeprecation(eventName: string): void {
    if (this._sentWarnings?.events[eventName as WarningEventName] === false) {
      console.warn(messages.warnings.events[eventName as WarningEventName]);
      this._sentWarnings.events[eventName as WarningEventName] = true;
    }
  }
  protected async _rpcRequest(
    payload: UnvalidatedJsonRpcRequest | UnvalidatedJsonRpcRequest[], //TODO: refactor to accept incoming batched requests
    callback: (...args: any[]) => void
  ) {
    let error = null;
    let result = null;
    let formatedResult = null;
    if (!Array.isArray(payload)) {
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
      return callback(error, formatedResult);
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
      const now = Date.now();

      // Check cache for provider state requests
      if (data && typeof data === 'object' && 'method' in data) {
        const method = data.method;

        // Cache provider state calls
        if (
          method === 'wallet_getProviderState' ||
          method === 'wallet_getSysProviderState'
        ) {
          const cache = this._providerStateCache[method];
          if (
            cache &&
            cache.data &&
            cache.timestamp &&
            cache.isValid &&
            now - cache.timestamp < BaseProvider.PROVIDER_STATE_CACHE_TTL
          ) {
            console.log(`[BaseProvider] Returning cached ${method} response`);
            resolve(cache.data);
            return;
          }
        }

        // Rate limit requests if we recently had connection errors
        if (
          !this._isBackgroundConnected &&
          now - this._lastConnectionError <
            BaseProvider.CONNECTION_ERROR_CACHE_TTL
        ) {
          reject({
            message: 'Pali: Background connection temporarily unavailable',
            code: -32603,
          });
          return;
        }
      }

      const id = Date.now() + '.' + Math.random();

      const handleResponse = (event: any) => {
        if (event.detail === undefined) {
          resolve(undefined);
          return;
        } else if (event.detail === null) {
          resolve(null);
          return;
        }

        try {
          const response = JSON.parse(event.detail);

          // Track connection success
          this._isBackgroundConnected = true;

          // Cache successful provider state responses
          if (data && typeof data === 'object' && 'method' in data) {
            const method = data.method;
            if (
              (method === 'wallet_getProviderState' ||
                method === 'wallet_getSysProviderState') &&
              !response.error
            ) {
              this._providerStateCache[method] = {
                data: response,
                timestamp: now,
                isValid: true,
              };
            }
          }

          if (response.error) {
            // Handle specific error types
            if (
              response.error.message &&
              (response.error.message.includes('Background script') ||
                response.error.message.includes('temporarily unavailable'))
            ) {
              this._isBackgroundConnected = false;
              this._lastConnectionError = now;
            }
            reject(response.error);
          } else {
            resolve(response);
          }
        } catch (parseError) {
          reject({
            message: 'Failed to parse response from background script',
            code: -32700,
          });
        }
      };

      window.addEventListener(id, handleResponse, {
        once: true,
        passive: true,
      });

      // No timeout - let requests wait indefinitely until response or page unload
      // Browser will automatically clean up when user navigates away or closes tab
      // This prevents authentication timeouts and provides better UX

      window.postMessage(
        {
          id,
          type,
          data,
        },
        '*'
      );
    });
}
