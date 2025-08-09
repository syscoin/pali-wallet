import { ISysAssetMetadata } from 'types/tokens';

import { BaseProvider, Maybe, RequestArguments } from './BaseProvider';
import messages from './messages';
import {
  EMITTED_NOTIFICATIONS,
  isValidChainId,
  isValidNetworkVersion,
} from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
interface SysProviderState {
  accounts: null | string[];
  blockExplorerURL: string | null;
  initialized: boolean;
  isBitcoinBased: boolean;
  isPermanentlyDisconnected: boolean;
  isUnlocked: boolean;
  xpub: string | null;
}
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

export class PaliInpageProviderSys extends BaseProvider {
  public readonly _sys: ReturnType<PaliInpageProviderSys['_getSysAPI']>;
  private static _defaultState: SysProviderState = {
    accounts: null,
    blockExplorerURL: null,
    xpub: null,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
    isBitcoinBased: false,
  };
  private _sysState: SysProviderState;
  public readonly version: number = 2;
  public networkVersion: string | null;
  public chainId: string | null;
  private _isInitializing = false;
  private _initializationPromise: Promise<void> | null = null;
  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('syscoin', maxEventListeners, wallet);
    this._sys = this._getSysAPI();
    // Private state
    this._sysState = {
      ...PaliInpageProviderSys._defaultState,
    };
    this.chainId = null;
    this.networkVersion = null;

    // Start initialization immediately and atomically
    this._initializeProvider();

    this.initMessageListener();
  }

  private _initializeProvider(): void {
    // Check if already initializing and return existing promise if so
    if (this._initializationPromise) {
      return;
    }

    this._isInitializing = true;
    this._initializationPromise = this.request({
      method: 'wallet_getSysProviderState',
    })
      .then((state) => {
        const initialState = state as Parameters<
          PaliInpageProviderSys['_initializeState']
        >[0];

        this._initializeState(initialState);
      })
      .catch((error) => {
        console.error(
          'Pali: Failed to get initial state. Please report this bug.',
          error
        );
        // Even if we fail to get initial state, mark as initialized
        // This allows the provider to function with default state
        this._initializeState();
      })
      .finally(() => {
        this._isInitializing = false;
        // Reset the promise to null to allow re-initialization if needed
        this._initializationPromise = null;
      });
  }

  public initMessageListener() {
    window.addEventListener(
      'paliNotification',
      (event: any) => {
        const { data } = JSON.parse(event.detail);

        const { method, params } = data;
        this.emit('walletUpdate');

        switch (method) {
          case 'pali_xpubChanged':
            this._handleConnectedXpub(params);
            break;
          case 'pali_unlockStateChanged':
            this._handleUnlockStateChanged(params);
            break;
          case 'pali_blockExplorerChanged':
            this._handleActiveBlockExplorer(params);
            break;
          case 'pali_isBitcoinBased':
            this._handleIsBitcoinBased(params);
            break;
          case EMITTED_NOTIFICATIONS.includes(method):
            break;
          // Handle accountsChanged for UTXO addresses so dapps can react to account updates
          case 'pali_accountsChanged':
            // Ensure params is always an array
            const accountsParams = Array.isArray(params)
              ? params
              : params
              ? [params]
              : [];
            this._handleAccountsChanged(accountsParams);
            break;
          case 'pali_chainChanged':
            this._handleChainChanged(params);
            break;
          case 'pali_removeProperty':
            break;
          case 'pali_addProperty':
            break;
          default:
            console.warn(
              '[PaliSysProvider] Unknown notification method:',
              method,
              'params:',
              params
            );
            console.warn(
              '[PaliSysProvider] Ignoring unknown notification - this is likely from a different provider or network type'
            );
            // Don't disconnect for unknown notifications - just ignore them
            // This prevents disconnection when switching networks or receiving notifications
            // intended for other providers (like Ethereum provider)
            break;
        }
      },
      { passive: true }
    );
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
    // For Sys provider, accept numeric networkVersion including 0; chainId must be '0x' hex but allow '0x0'
    if (!isValidChainId(chainId) || !isValidNetworkVersion(networkVersion)) {
      console.error(messages.errors.invalidNetworkParams(), {
        chainId,
        networkVersion,
      });
      return;
    }

    if (chainId !== this.chainId) {
      this.chainId = chainId;
      this.networkVersion = networkVersion;
      if (this._sysState.initialized && isBitcoinBased) {
        this.emit('chainChanged', this.chainId);
      }
    } else if (isBitcoinBased) {
      if (this._sysState.initialized) {
        this.emit('chainChanged', chainId);
      }
    }
  }

  public async activeExplorer(): Promise<string> {
    if (!this._sysState.initialized) {
      // If not initialized and no initialization in progress, start it
      if (!this._initializationPromise) {
        this._initializeProvider();
      }
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.blockExplorerURL;
  }

  private _initializeState(initialState?: {
    accounts: string[];
    blockExplorerURL: string | null;
    isBitcoinBased: boolean;
    isUnlocked: boolean;
    xpub: string;
  }) {
    if (this._sysState.initialized === true) {
      throw new Error('Pali SyscoinProvider: Provider already initialized.');
    }

    if (initialState) {
      const { accounts, xpub, blockExplorerURL, isUnlocked, isBitcoinBased } =
        initialState;

      // EIP-1193 connect
      this._handleConnectedXpub(xpub);
      this._handleActiveBlockExplorer(blockExplorerURL);
      this._handleUnlockStateChanged({ accounts, xpub, isUnlocked });
      this._handleIsBitcoinBased({ isBitcoinBased });
    }

    // Mark provider as initialized regardless of whether initial state was
    // retrieved.
    this._sysState.initialized = true;
    this.emit('_sysInitialized');
  }

  public async isUnlocked(): Promise<boolean> {
    if (!this._sysState.initialized) {
      // If not initialized and no initialization in progress, start it
      if (!this._initializationPromise) {
        this._initializeProvider();
      }
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.isUnlocked;
  }

  public isBitcoinBased(): boolean {
    // If initialized, return the actual state
    if (this._sysState.initialized) {
      return this._sysState.isBitcoinBased;
    }

    // If not initialized, try to get a quick state check
    // Start initialization if not already in progress
    if (!this._initializationPromise) {
      this._initializeProvider();
    }

    // For the Syscoin provider, we need to be more careful about the default
    // Check if we have any reliable indicator of the network type

    // Default to false (EVM) to be safe - this will show the network switch button
    // which is better UX than blocking calls with wrong network assumptions
    // The proper state will be updated once initialization completes
    return false;
  }

  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
  public async request<T>(args: RequestArguments): Promise<Maybe<T>> {
    if (args.method !== 'wallet_getSysProviderState') {
      // Wait for initialization if not already initialized
      if (!this._sysState.initialized) {
        // If not initialized and no initialization in progress, start it
        if (!this._initializationPromise) {
          this._initializeProvider();
        }
        await new Promise<void>((resolve) => {
          this.on('_sysInitialized', () => resolve());
        });
      }
    }
    return super.request(args);
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
    xpub,
    isUnlocked,
  }: { accounts?: string[]; isUnlocked?: boolean; xpub?: string | null } = {}) {
    if (typeof isUnlocked !== 'boolean') {
      console.error(
        'Pali: Received invalid isUnlocked parameter. Please report this bug.'
      );
      return;
    }

    if (isUnlocked !== this._sysState.isUnlocked) {
      this._sysState.isUnlocked = isUnlocked;
      this._handleConnectedXpub(xpub);
      this._handleAccountsChanged(accounts || []);
    }
  }

  /**
   * Upon receipt of a new connectedAccountXpub state.
   *
   *
   * @param opts - Options bag.
   * @param opts.accounts - The exposed accounts, if any.
   * @param opts.isUnlocked - The latest isUnlocked value.
   */
  private _handleConnectedXpub(xpub: string | null) {
    if (!isHexString(xpub) || xpub === null) {
      this._sysState.xpub = xpub;
    }
  }

  private _handleActiveBlockExplorer(blockExplorerURL: string | null) {
    this._sysState.blockExplorerURL = blockExplorerURL;
  }
  private _handleAccountsChanged(
    currentAccounts: unknown[] | null | undefined
  ): void {
    // Only emit for Bitcoin-based networks
    if (!this._sysState.isBitcoinBased) {
      return;
    }

    // Normalize input
    if (currentAccounts === undefined || currentAccounts === null) {
      currentAccounts = [];
    }

    let accounts = currentAccounts as any[];
    if (!Array.isArray(accounts)) {
      accounts = [];
    }

    // If first account looks like hex (EVM), skip emitting for Sys provider
    if (accounts.length > 0 && isHexString(accounts[0])) {
      return;
    }

    // Ensure values are strings
    const validAccounts = accounts.filter((a) => typeof a === 'string');

    // Avoid duplicate emissions: compare with previous state
    const previousAccounts = this._sysState.accounts;
    const accountsChanged =
      JSON.stringify(previousAccounts) !== JSON.stringify(validAccounts);

    // Update state before potentially emitting
    this._sysState.accounts = validAccounts;

    // Only emit after provider is initialized and when accounts actually changed
    if (this._sysState.initialized && accountsChanged) {
      this.emit('accountsChanged', validAccounts);
    }
  }
  private _handleIsBitcoinBased({
    isBitcoinBased,
  }: {
    isBitcoinBased: boolean;
  }) {
    this._sysState.isBitcoinBased = isBitcoinBased;
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
    if (!this._sysState.isPermanentlyDisconnected && !isRecoverable) {
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
        this._sysState.blockExplorerURL = null;
        this._sysState.xpub = null;
        this._sysState.isUnlocked = false;
      }

      this.emit('Sys_disconnect', error);
    }
  }

  private _getSysAPI() {
    return new Proxy(
      {
        /**
         * Get the minted tokens by the current connected Xpub on UTXO chain.
         *
         * @returns Promise send back tokens data
         */
        getUserMintedTokens: async () => {
          const account = await this.request({ method: 'wallet_getAccount' });
          if (account) {
            const { transactions } = account as any;

            // Filter for asset allocation mint transactions (Syscoin 5)
            const filteredTxs = transactions?.filter(
              (tx: any) => tx.tokenType === 'assetallocationmint'
            );

            const allTokens = [];

            for (const txs of filteredTxs) {
              for (const tokens of txs.tokenTransfers) {
                if (tokens) {
                  allTokens.push(tokens);
                }
              }
            }

            const txs = await Promise.all(
              allTokens.map(async (t: any) => {
                const assetInfo = (await this.request({
                  method: 'wallet_getSysAssetMetadata',
                  params: [t.token, this._sysState.blockExplorerURL],
                })) as ISysAssetMetadata | null;

                // Return the asset info with the symbol as-is (Syscoin 5 uses plain text)
                if (assetInfo && assetInfo.assetGuid) {
                  return {
                    ...assetInfo,
                    symbol: assetInfo.symbol, // Syscoin 5 uses plain text symbols
                  };
                }
                return undefined;
              })
            );

            return txs.filter((item) => item !== undefined);
          }
          return [];
        },
        /**
         * Get held assets by current connected account on UTXO chain.
         *
         * @returns Promise send back tokens data
         */
        getHoldingsData: async () => {
          const { syscoin }: { syscoin: any[] } = (await this.request({
            method: 'wallet_getTokens',
          })) as any;

          if (syscoin.length) {
            return syscoin;
          }

          return [];
        },
        //Get current connected Xpub
        getConnectedAccountXpub: () => this._sysState.xpub,

        //Get changeAddress
        getChangeAddress: async () =>
          this.request({ method: 'wallet_getChangeAddress' }),
        /**
         * Get the minted tokens by the current connected Xpub on UTXO chain.
         *
         * @returns Promise send back tokens data
         */
        getDataAsset: async (assetGuid: any) => {
          if (!this._sysState.initialized) {
            // If not initialized and no initialization in progress, start it
            if (!this._initializationPromise) {
              this._initializeProvider();
            }
            await new Promise<void>((resolve) => {
              this.on('_sysInitialized', () => resolve());
            });
          }
          return this.request({
            method: 'wallet_getSysAssetMetadata',
            params: [assetGuid, this._sysState.blockExplorerURL],
          });
        },
      },
      {
        get: (obj, prop, ...args) => Reflect.get(obj, prop, ...args),
      }
    );
  }
}
