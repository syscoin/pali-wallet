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

// Native utility to check if a string is a valid hex string
function isHexString(value: any): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  // Must start with 0x
  if (!value.startsWith('0x')) {
    return false;
  }

  // Remove 0x prefix and check if remaining characters are valid hex
  const hexPart = value.slice(2);

  // Empty hex string after 0x is valid
  if (hexPart.length === 0) {
    return true;
  }

  // Check if all characters are valid hexadecimal
  const hexRegex = /^[0-9a-fA-F]+$/;
  return hexRegex.test(hexPart);
}

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
    this._handleAccountDisconnect = this._handleAccountDisconnect.bind(this);
    this._handleUnlockStateChanged = this._handleUnlockStateChanged.bind(this);
    // Private state
    this._state = {
      ...PaliInpageProviderEth._defaultState,
    };
    // Public state
    this.selectedAddress = null;
    this.chainId = null;

    // Start initialization immediately and atomically
    this._checkNetworkTypeAndInitialize();

    this.initMessageListener();
  }

  private async _checkNetworkTypeAndInitialize(): Promise<void> {
    // If already initializing, wait for the existing promise
    if (this._initializationPromise) {
      return this._initializationPromise;
    }

    // Create the promise but don't await it here
    this._initializationPromise = this._initializeEthereumProvider().finally(
      () => {
        // Clean up after completion (success or failure)
        this._initializationPromise = null;
      }
    );

    return this._initializationPromise;
  }

  private _initializeEthereumProvider() {
    return this.request({ method: 'wallet_getProviderState' })
      .then((state) => {
        const initialState = state as Parameters<
          PaliInpageProviderEth['_initializeState']
        >[0];
        this._initializeState(initialState);
      })
      .catch((error) => {
        console.error(
          'Pali: Failed to get initial state. Please report this bug.',
          error
        );
        // Even if we fail to get initial state, we should still mark the provider as initialized
        // This ensures the provider can function with default state on EVM networks
        this._initializeState();
      });
  }

  public initMessageListener() {
    window.addEventListener(
      'paliNotification',
      (event: any) => {
        try {
          const parsed = JSON.parse(event.detail);

          // Handle both event structures for compatibility
          const data = parsed.data || parsed;
          const { method, params } = data;

          switch (method) {
            case 'pali_accountsChanged':
              // Ensure params is always an array
              const accountsParams = Array.isArray(params)
                ? params
                : params
                ? [params]
                : [];
              this._handleAccountsChanged(accountsParams);
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
            case EMITTED_NOTIFICATIONS.includes(method): {
              // Forward eth_subscription notifications to dapps via EIP-1193 'message' event
              // params is expected to be { subscription, result }
              const payload = {
                type: 'eth_subscription',
                data: params,
              } as any;

              try {
                // EIP-1193 standard
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                this.emit?.('message', payload);
              } catch (e) {
                // no-op
              }

              try {
                // Legacy 'data' event some libs still listen to
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                this.emit?.('data', { method, params });
              } catch (e) {
                // no-op
              }

              break;
            }
            default:
              console.warn(
                '[PaliEthProvider] Unknown notification method:',
                method,
                'params:',
                params
              );
              console.warn(
                '[PaliEthProvider] Ignoring unknown notification - this is likely from a different provider or network type'
              );
              // Don't disconnect for unknown notifications - just ignore them
              // This prevents disconnection when switching networks or receiving notifications
              // intended for other providers (like Syscoin provider)
              break;
          }
        } catch (error) {
          console.error('[PaliEthProvider] Error processing event:', error);
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
   * Returns whether the provider has been initialized.
   */
  isInitialized(): boolean {
    return this._state.initialized;
  }

  /**
   * Returns the current accounts if available.
   * This is used by dapps to check connection state.
   */
  get accounts(): string[] {
    return this._state.accounts || [];
  }

  /**
   * Connect method for Web3Modal and other libraries.
   * This is a convenience method that wraps eth_requestAccounts.
   */
  async connect(): Promise<string[]> {
    return this.request({ method: 'eth_requestAccounts' }) as Promise<string[]>;
  }

  /**
   * Internal backwards compatibility method, used in send.
   *
   * @deprecated
   */
  sendAsync(
    payload: any,
    callback?: (error: Error | null, result?: any) => void
  ): void | Promise<any> {
    // Support both callback and promise-based patterns
    if (callback && typeof callback === 'function') {
      // Traditional callback pattern
      this._rpcRequest(payload, callback);
    } else {
      // Promise-based pattern (like MetaMask)
      return new Promise((resolve, reject) => {
        this._rpcRequest(payload, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
    }
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
          this._handleAccountsChanged(res?.result || []);
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
        // If provider is not initialized yet, we should wait or return empty
        // This prevents Web3Modal from getting incomplete state
        if (!this._state.initialized) {
          console.warn(
            'Pali: eth_accounts called before provider initialization'
          );
          result = [];
        } else if (this._state.accounts && this._state.accounts.length > 0) {
          // Return accounts from state if available
          result = this._state.accounts;
        } else if (this.selectedAddress) {
          result = [this.selectedAddress];
        } else {
          result = [];
        }
        break;

      case 'eth_coinbase':
        // Return first account from state if selectedAddress isn't set
        if (!this._state.initialized) {
          result = null;
        } else if (this.selectedAddress) {
          result = this.selectedAddress;
        } else if (this._state.accounts && this._state.accounts.length > 0) {
          result = this._state.accounts[0];
        } else {
          result = null;
        }
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
    currentAccounts: unknown[] | null | undefined
  ): void {
    // Handle edge case of undefined being passed
    if (currentAccounts === undefined) {
      currentAccounts = [];
    }

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

    for (const account of accounts) {
      if (typeof account !== 'string' && account !== null) {
        console.error(
          'Pali EthereumProvider: Received non-string account. Please report this bug.',
          currentAccounts
        );
        accounts = [];
        break;
      }
    }

    // If we're on a Bitcoin-based network, ignore account updates for the Ethereum provider
    if (this._state.isBitcoinBased) {
      this._state.accounts = [];
      this.selectedAddress = null;
      return;
    }

    // If any non-hex accounts are passed (e.g., UTXO addresses), ignore and do not emit
    if (accounts.length > 0 && !isHexString(accounts[0])) {
      this._state.accounts = [];
      this.selectedAddress = null;
      return;
    }

    // emit accountsChanged if anything about the accounts array has changed
    // Note: It's normal for eth_accounts to return different accounts than what's in state,
    // especially when dapps are disconnected, during network switches, or permission changes.
    // The provider should handle these changes gracefully.

    // Check if accounts actually changed before updating state
    const previousAccounts = this._state.accounts;
    const accountsChanged =
      JSON.stringify(previousAccounts) !== JSON.stringify(accounts);

    // Check if we're transitioning from no accounts to having accounts (new connection)
    const wasConnected = previousAccounts && previousAccounts.length > 0;
    const isNowDisconnected = !accounts || accounts.length === 0;
    const wasDisconnected = !previousAccounts || previousAccounts.length === 0;
    const isNowConnected = accounts && accounts.length > 0;
    const isNewConnection = wasDisconnected && isNowConnected;
    const isDisconnection = wasConnected && isNowDisconnected;

    // Update state before emitting events
    if (accounts.length > 0 && isHexString(accounts[0])) {
      this._state.accounts = accounts as string[];
    } else {
      // Clear accounts when empty
      this._state.accounts = [];
    }

    // handle selectedAddress
    if (this.selectedAddress !== accounts[0]) {
      if (accounts.length > 0 && isHexString(accounts[0])) {
        this.selectedAddress = (accounts[0] as string) || null;
      } else {
        this.selectedAddress = null;
      }
    }

    // If this is a disconnection (accounts went from having accounts to empty),
    // emit disconnect event
    if (this._state.initialized && isDisconnection) {
      this._handleAccountDisconnect();
    }

    // If this is a new connection (accounts went from empty to having accounts),
    // emit connect event first, then accountsChanged
    if (this._state.initialized && isNewConnection && this.chainId) {
      // Emit connect event for new connections
      this._handleConnect(this.chainId);
    }

    // finally, after all state has been updated, emit the event
    if (this._state.initialized && accountsChanged) {
      this.emit('accountsChanged', this._state.accounts);
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
   * When accounts are disconnected, emit disconnect event
   * This is different from _handleDisconnect which handles connection errors
   *
   * @emits PaliInpageProvider#disconnect
   */
  private _handleAccountDisconnect() {
    if (this._state.isConnected) {
      this._state.isConnected = false;
      this.emit('disconnect', { code: 4900, message: 'User disconnected' });
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
    // Accept '0x0' and networkVersion 0 during transitions without emitting errors
    if (!isValidChainId(chainId) || !isValidNetworkVersion(networkVersion)) {
      console.error(messages.errors.invalidNetworkParams(), {
        chainId,
        networkVersion,
      });
      return;
    }

    if (this.isMetaMask && this.networkVersion !== (networkVersion as any)) {
      // Coerce to string to maintain web3 expectations
      this.networkVersion =
        networkVersion === undefined || networkVersion === null
          ? null
          : String(networkVersion);
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
            // If not initialized and no initialization in progress, start it
            if (!this._initializationPromise) {
              await this._checkNetworkTypeAndInitialize();
            } else {
              // Wait for the existing initialization to complete
              await this._initializationPromise;
            }

            // Double-check initialization completed successfully
            if (!this._state.initialized) {
              await new Promise<void>((resolve) => {
                const handler = () => {
                  this.off('_initialized', handler);
                  resolve();
                };
                this.on('_initialized', handler);
              });
            }
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
