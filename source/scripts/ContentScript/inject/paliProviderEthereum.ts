import { ethers } from 'ethers';

import { INetworkType } from '@pollum-io/sysweb3-network';

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
  private _initializationPromise: Promise<void> | null = null;

  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super(INetworkType.Ethereum, maxEventListeners, wallet);
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

    // Start initialization immediately and atomically
    this._checkNetworkTypeAndInitialize();

    this.initMessageListener();
  }

  private async _checkNetworkTypeAndInitialize(): Promise<void> {
    // If already initializing, wait for the existing promise
    if (this._initializationPromise) {
      return this._initializationPromise;
    }

    this._initializationPromise = (async () => {
      try {
        // 🔥 FIX: Try getSysProviderState first (works on all networks)
        const syscoinState = await this.request({
          method: 'wallet_getSysProviderState',
        });

        if (syscoinState) {
          console.log('Syscoin provider state obtained, initializing...');

          // Check if this is a UTXO network
          const { isBitcoinBased } = syscoinState as any;
          if (isBitcoinBased) {
            console.log(
              'UTXO network detected, not initializing Ethereum provider'
            );
            // Don't initialize Ethereum provider for pure UTXO networks
            return;
          }

          // If not Bitcoin-based, initialize Ethereum provider
          return this._initializeEthereumProvider();
        }
      } catch (sysError) {
        console.log(
          'getSysProviderState failed, trying getProviderState:',
          sysError.message
        );

        // 🔥 FIX: Only try getProviderState if getSysProviderState fails
        // This handles EVM networks properly
        try {
          const providerState = await this.request({
            method: 'wallet_getProviderState',
          });

          if (providerState) {
            const { isBitcoinBased } = providerState as any;
            if (!isBitcoinBased) {
              console.log('EVM network confirmed via provider state');
              return this._initializeEthereumProvider();
            } else {
              console.log(
                'Bitcoin network detected, not initializing Ethereum provider'
              );
              return;
            }
          }
        } catch (providerError) {
          console.log(
            'Both provider state calls failed, network type unclear:',
            providerError.message
          );
          // If both calls fail, we should still attempt to initialize as an EVM provider
          // This ensures the provider works on EVM networks even if initial state calls fail
          console.log(
            'Attempting EVM initialization despite state call failures'
          );
          return this._initializeEthereumProvider();
        }
      }
    })();

    try {
      await this._initializationPromise;
    } finally {
      // Reset the promise to null to allow re-initialization if needed
      this._initializationPromise = null;
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
