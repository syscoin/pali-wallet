import { ethers } from 'ethers';

import {
  BaseProvider,
  UnvalidatedJsonRpcRequest,
  JsonRpcSuccessStruct,
} from './BaseProvider';
import messages from './messages';
import {
  EMITTED_NOTIFICATIONS,
  getRpcPromiseCallback,
  NOOP,
  isValidChainId,
  isValidNetworkVersion,
} from './utils';

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

// eslint-disable-next-line @typescript-eslint/naming-convention
interface EthereumProviderState {
  accounts: null | string[];
  initialized: boolean;
  isBitcoinBased: boolean;
  isConnected: boolean;
  isPermanentlyDisconnected: boolean;
  isUnlocked: boolean;
}

export class PaliInpageProviderEth extends BaseProvider {
  public readonly _metamask: ReturnType<
    PaliInpageProviderEth['_getExperimentalApi']
  >;
  public networkVersion: string | null;
  public chainId: string | null;
  public selectedAddress: string | null;
  private static _defaultState: EthereumProviderState = {
    accounts: null,
    isConnected: false,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
    isBitcoinBased: false,
  };
  protected _state: EthereumProviderState;
  public readonly isMetaMask: boolean = true;
  private _isInitializing = false;
  private _initializationPromise: Promise<void> | null = null;

  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('ethereum', maxEventListeners, wallet);
    this._metamask = this._getExperimentalApi();
    this._sendSync = this._sendSync.bind(this);
    this.send = this.send.bind(this);
    this.sendAsync = this.sendAsync.bind(this);
    this._handleAccountsChanged = this._handleAccountsChanged.bind(this);
    this._handleConnect = this._handleConnect.bind(this);
    this._handleChainChanged = this._handleChainChanged.bind(this);
    this._handleDisconnect = this._handleDisconnect.bind(this);
    this._handleUnlockStateChanged = this._handleUnlockStateChanged.bind(this);
    // Private state
    this._state = {
      ...PaliInpageProviderEth._defaultState,
    };
    // Public state
    this.selectedAddress = null;
    this.chainId = null;

    // Only initialize provider state for EVM-compatible networks
    // Check network type before making any provider state requests
    if (!this._isInitializing && !this._initializationPromise) {
      this._isInitializing = true;
      this._initializationPromise =
        this._checkNetworkTypeAndInitialize().finally(() => {
          this._isInitializing = false;
        });
    }

    this.initMessageListener();
  }

  private async _checkNetworkTypeAndInitialize(): Promise<void> {
    try {
      // First, try to get the syscoin provider state to determine network type
      const sysState = (await this.request({
        method: 'wallet_getSysProviderState',
      })) as any;

      // If we successfully get syscoin state and it's Bitcoin-based, skip EVM initialization
      if (sysState?.isBitcoinBased) {
        console.log(
          'Network is Bitcoin-based (UTXO), skipping Ethereum provider initialization'
        );
        this._state.isBitcoinBased = true;
        return;
      }

      // If not Bitcoin-based, try to initialize as EVM network
      if (sysState && !sysState.isBitcoinBased) {
        console.log(
          'Network is EVM-compatible, initializing Ethereum provider'
        );
        return this._initializeEthereumProvider();
      }
    } catch (sysError) {
      console.log(
        'Syscoin provider state call failed, checking if this is an EVM network:',
        sysError.message
      );

      // If syscoin provider state fails, it might be a non-Syscoin EVM network
      // Only proceed if we're confident this is an EVM network (not localhost or blockbook URLs)
      const currentUrl = window.location.href;
      const isLocalhost =
        currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1');

      if (isLocalhost) {
        console.log('Detected localhost environment, proceeding with caution');
      }

      try {
        // Try a lightweight check first - just get network version without full provider state
        const networkVersionResult = (await this.request({
          method: 'net_version',
        })) as string;

        if (networkVersionResult) {
          console.log(
            'Successfully got net_version, this appears to be an EVM network'
          );
          return this._initializeEthereumProvider();
        }
      } catch (netError) {
        console.log(
          'net_version call failed, this is likely not an EVM network:',
          netError.message
        );
        // If both syscoin and basic EVM calls fail, don't initialize
        return;
      }
    }
  }

  private _initializeEthereumProvider() {
    return this.request({ method: 'wallet_getProviderState' })
      .then((state) => {
        console.log('state', state);
        const initialState = state as Parameters<
          PaliInpageProviderEth['_initializeState']
        >[0];
        this._initializeState(initialState);
      })
      .catch((error) =>
        console.error(
          'Pali: Failed to get initial state. Please report this bug.',
          error
        )
      );
  }

  public initMessageListener() {
    window.addEventListener(
      'paliNotification',
      (event: any) => {
        const { method, params } = JSON.parse(event.detail);

        switch (method) {
          case 'pali_accountsChanged':
            this._handleAccountsChanged(params);
            break;
          case 'pali_unlockStateChanged':
            this._handleUnlockStateChanged(params);
            break;
          case 'pali_chainChanged':
            this._handleChainChanged(params);
            break;
          case 'pali_isBitcoinBased':
            this._handleIsBitcoinBased(params);
            break;
          case 'pali_removeProperty':
            break;
          case 'pali_addProperty':
            break;
          // UTXO METHODS TO AVOID.
          case 'pali_xpubChanged':
            break;
          case 'pali_blockExplorerChanged':
            break;
          case 'pali_isTestnet':
            break;
          case EMITTED_NOTIFICATIONS.includes(method):
            //TODO: implement subscription messages
            throw {
              code: 69,
              message:
                'Pali EthereumProvider: Does not yet have subscription to rpc methods',
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

  /**
   * Returns whether the provider can process RPC requests.
   */
  isConnected(): boolean {
    return this._state.isConnected;
  }

  isBitcoinBased(): boolean {
    return this._state.isBitcoinBased;
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
            getRpcPromiseCallback(resolve, reject)
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

  //====================
  // Private Methods
  //====================

  protected async _rpcRequest(
    payload: UnvalidatedJsonRpcRequest | UnvalidatedJsonRpcRequest[], //TODO: refactor to accept incoming batched requests
    callback: (...args: any[]) => void
  ) {
    let cb = callback;
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
    }
    return super._rpcRequest(payload, cb);
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

  private _handleIsBitcoinBased({
    isBitcoinBased,
  }: {
    isBitcoinBased: boolean;
  }) {
    this._state.isBitcoinBased = isBitcoinBased;
  }

  private _handleAccountsChanged(
    currentAccounts: unknown[] | null,
    isEthAccounts = false
  ): void {
    if (currentAccounts === null) {
      this._state.accounts = currentAccounts as any;

      if (this._state.initialized) {
        this.emit('accountsChanged', currentAccounts as any);
      }
      return;
    }
    let accounts = currentAccounts as any[];

    if (!Array.isArray(currentAccounts)) {
      console.error(
        'Pali EthereumProvider: Received invalid accounts parameter. Please report this bug.',
        currentAccounts
      );
      accounts = [];
    }

    for (const account of currentAccounts) {
      if (typeof account !== 'string' && account !== null) {
        console.error(
          'Pali EthereumProvider: Received non-string account. Please report this bug.',
          currentAccounts
        );
        accounts = [];
        break;
      }
    }

    // emit accountsChanged if anything about the accounts array has changed
    // we should always have the correct accounts even before eth_accounts
    // returns
    this._state.accounts = []; // just for testing purposes
    if (
      isEthAccounts &&
      this._state.accounts !== null &&
      this._state.accounts.length !== 0
    ) {
      console.error(
        `Pali EthereumProvider: 'eth_accounts' unexpectedly updated accounts. Please report this bug.`,
        accounts
      );
    }

    if (ethers.utils.isHexString(accounts[0])) {
      this._state.accounts = accounts as string[];
    }

    // handle selectedAddress
    if (this.selectedAddress !== accounts[0]) {
      if (ethers.utils.isHexString(accounts[0])) {
        this.selectedAddress = (accounts[0] as string) || null;
      }
    }

    // finally, after all state has been updated, emit the event
    if (this._state.initialized) {
      this.emit('accountsChanged', accounts);
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
    isBitcoinBased,
  }: {
    chainId?: string;
    isBitcoinBased?: boolean;
    networkVersion?: string;
  } = {}) {
    if (!isValidChainId(chainId) || !isValidNetworkVersion(networkVersion)) {
      console.error(messages.errors.invalidNetworkParams(), {
        chainId,
        networkVersion,
      });
      return;
    }

    if (this.isMetaMask && this.networkVersion !== networkVersion) {
      this.networkVersion = networkVersion || null;
    }

    if (chainId !== this.chainId) {
      this.chainId = chainId || null;
      if (this._state.initialized && !isBitcoinBased) {
        this.emit('chainChanged', this.chainId);
      }
    } else if (!isBitcoinBased) {
      if (this._state.initialized) {
        this.emit('chainChanged', chainId);
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
    if (typeof isUnlocked !== 'boolean') {
      console.error(
        'Pali EthereumProvider: Received invalid isUnlocked parameter. Please report this bug.'
      );
      return;
    }

    if (isUnlocked !== this._state.isUnlocked) {
      this._state.isUnlocked = isUnlocked;
      this._handleAccountsChanged(accounts || []);
    }
  }

  /**
   *
   * Sets initial state if provided and marks this provider as initialized.
   * Throws if called more than once.
   *
   * @param initialState - The provider's initial state.
   * @emits EthereumProvider#_initialized
   * @emits EthereumProvider#connect - If `initialState` is defined.
   */
  private _initializeState(initialState?: {
    accounts: string[];
    chainId: string;
    isBitcoinBased: boolean;
    isUnlocked: boolean;
    networkVersion?: string;
  }) {
    if (this._state.initialized === true) {
      throw new Error('Pali EthereumProvider: Provider already initialized.');
    }

    if (initialState) {
      const { accounts, chainId, isUnlocked, networkVersion, isBitcoinBased } =
        initialState;

      // EIP-1193 connect
      this._handleConnect(chainId);
      this._handleChainChanged({ chainId, networkVersion, isBitcoinBased });
      this._handleUnlockStateChanged({ accounts, isUnlocked });
      this._handleAccountsChanged(accounts);
      this._handleIsBitcoinBased({ isBitcoinBased });
    }

    // Mark provider as initialized regardless of whether initial state was
    // retrieved.
    this._state.initialized = true;
    this.emit('_initialized');
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
