import { EventEmitter } from 'events';

import messages from './messages';
import { isValidChainId, isValidNetworkVersion } from './utils';

export type Maybe<T> = Partial<T> | null | undefined;
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface BaseProviderState {
  accounts: null | string[];
  initialized: boolean;
  isConnected: boolean;
  isPermanentlyDisconnected: boolean;
  isUnlocked: boolean;
}
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface RequestArguments {
  /** The RPC method to request. */
  method: string;

  /** The params of the RPC method, if any. */
  params?: unknown[] | Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface UnvalidatedJsonRpcRequest {
  method: string;
  params?: unknown;
}

export class PaliInpageProvider {
  emitter: EventEmitter;
  public readonly _metamask: ReturnType<
    PaliInpageProvider['_getExperimentalApi']
  >;
  public chainType: string;
  public networkVersion: string | null;
  public chainId: string | null;
  public selectedAddress: string | null;
  public wallet: string;
  protected static _defaultState: BaseProviderState = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };
  protected _state: BaseProviderState;

  /**
   * Indicating that this provider is a MetaMask provider.
   */
  public readonly isMetaMask: true;
  constructor(chainType, maxEventListeners = 100, wallet = 'pali-v2') {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(maxEventListeners);
    // Private state
    this._state = {
      ...PaliInpageProvider._defaultState,
    };
    // Public state
    this.selectedAddress = null;
    this.chainId = null;
    this.wallet = wallet;
    this._state;
    this.chainType = chainType;
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
  public async request<T>(args: RequestArguments): Promise<any> {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw {
        code: 420,
        message: messages.errors.invalidRequestArgs(),
        data: args,
      };
      //   throw ethErrors.rpc.invalidRequest({
      //     message: messages.errors.invalidRequestArgs(),
      //     data: args,
      //   });
    }

    const { method, params } = args;

    if (typeof method !== 'string' || method.length === 0) {
      throw {
        code: 69,
        message: messages.errors.invalidRequestMethod(),
        data: args,
      };
      //   throw ethErrors.rpc.invalidRequest({
      //     message: messages.errors.invalidRequestMethod(),
      //     data: args,
      //   });
    }

    if (
      params !== undefined &&
      !Array.isArray(params) &&
      (typeof params !== 'object' || params === null)
    ) {
      throw {
        code: 42069,
        message: messages.errors.invalidRequestParams(),
        data: args,
      };
      //   throw ethErrors.rpc.invalidRequest({
      //     message: messages.errors.invalidRequestParams(),
      //     data: args,
      //   });
    }

    return this._rpcRequest({ method, params });
  }

  //====================
  // Private Methods
  //====================

  private _rpcRequest(
    payload: UnvalidatedJsonRpcRequest | UnvalidatedJsonRpcRequest[] //TODO: refactor to accept incoming batched requests
  ) {
    if (!Array.isArray(payload)) {
      if (
        payload.method === 'eth_requestAccounts' ||
        payload.method === 'eth_accounts'
      ) {
        throw {
          code: 6969,
          message: 'DO it',
          data: null,
        };
        //TODO: Create _handleChangeAccount method to deal with this kind of transition
        // let addr = event.detail.replace('[', '');
        // addr = addr.replace(']', '');
        // addr = addr.replaceAll('"', '');
        // this.selectedAddress = addr;
      }
      return this.proxy('METHOD_REQUEST', payload);
    }
    throw {
      code: 123,
      message: messages.errors.invalidBatchRequest(),
      data: null,
    };
  }
  private proxy = (type: string, data: UnvalidatedJsonRpcRequest) => {
    new Promise((resolve, reject) => {
      const id = Date.now() + '.' + Math.random();

      window.addEventListener(
        id,
        (event: any) => {
          //TODO: Add proper event for our event handling methods
          // console.log('[Pali] EventListener method', data.method );
          if (event.detail === undefined) {
            resolve(undefined);

            return;
          } else if (event.detail === null) {
            resolve(null);

            return;
          }

          const response = JSON.parse(event.detail);
          if (response?.code === 4001 || response?.code === -32603) {
            //TODO: refactor so all reject cases go through response.error if condition
            console.log('Check response that triggered this situation');
            reject(response);
            return;
          }
          if (response.error) {
            reject(response.error); //TODO all the errors function needs to be refactored this part should not add new Error on response rejection

            return;
          }

          if (
            data.method === 'eth_requestAccounts' ||
            data.method === 'eth_accounts'
          ) {
            //TODO: enhance this implementation
            let addr = event.detail.replace('[', '');
            addr = addr.replace(']', '');
            addr = addr.replaceAll('"', '');
            this.selectedAddress = addr;
          }
          resolve(response);

          return response;
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
  };

  protected _getExperimentalApi() {
    return new Proxy(
      {
        /**
         * Determines if MetaMask is unlocked by the user.
         *
         * @returns Promise resolving to true if MetaMask is currently unlocked
         */
        isUnlocked: async () => {
          if (!this._state.initialized) {
            await new Promise<void>((resolve) => {
              this.emitter.on('_initialized', () => resolve());
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
}
