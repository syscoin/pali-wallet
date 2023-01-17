import {
  BaseProvider,
  WarningEventName,
  UnvalidatedJsonRpcRequest,
} from './BaseProvider';
import messages from './messages';
import { getRpcPromiseCallback, NOOP } from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
interface SendSyncJsonRpcRequest {
  id: any;
  jsonrpc: any;
  method:
    | 'eth_accounts'
    | 'eth_coinbase'
    | 'eth_uninstallFilter'
    | 'net_version';
}

export class PaliInpageProviderEth extends BaseProvider {
  public readonly _metamask: ReturnType<
    PaliInpageProviderEth['_getExperimentalApi']
  >;
  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('ethereum', maxEventListeners, wallet);
    this._metamask = this._getExperimentalApi();
    this._sendSync = this._sendSync.bind(this);
    this.send = this.send.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
  }

  /**
   * Internal backwards compatibility method, used in send.
   *
   * @deprecated
   */
  sendAsync(
    payload: any,
    callback: (error: Error | null, result?: any) => void
  ): void {
    this._rpcRequest(payload, callback);
  }

  /**
   * Internal backwards compatibility method, used in send.
   *
   * @deprecated
   */
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
}
