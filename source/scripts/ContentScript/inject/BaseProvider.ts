import { EventEmitter } from 'events';

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
  chain: string;
  chainId?: unknown;
}
//TODO: switch to SafeEventEmitter
export class BaseProvider extends EventEmitter {
  public wallet: string;
  public chainType: string;
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
    // this.isUnlocked = this.isUnlocked.bind(this);
  }

  //====================
  // Public Methods
  //====================

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
}
