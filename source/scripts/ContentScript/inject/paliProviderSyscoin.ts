import { isNFT as _isNFT, getAsset } from '@pollum-io/sysweb3-utils';

import { BaseProvider } from './BaseProvider';
import messages from './messages';

// eslint-disable-next-line @typescript-eslint/naming-convention
interface SysProviderState {
  blockExplorerURL: string | null;
  initialized: boolean;
  isPermanentlyDisconnected: boolean;
  isUnlocked: boolean;
  xpub: string | null;
}

export class PaliInpageProviderSys extends BaseProvider {
  public readonly _sys: ReturnType<PaliInpageProviderSys['_getSysAPI']>;
  private static _defaultState: SysProviderState = {
    blockExplorerURL: null,
    xpub: null,
    isUnlocked: false,
    initialized: false,
    isPermanentlyDisconnected: false,
  };
  private _sysState: SysProviderState;
  public readonly version: number = 2;
  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('syscoin', maxEventListeners, wallet);
    this._sys = this._getSysAPI();
    // Private state
    this._sysState = {
      ...PaliInpageProviderSys._defaultState,
    };
    console.log('Pali SyscoinProvider: Initializing SysProvider');
    this.request({ method: 'wallet_getSysProviderState' })
      .then((state) => {
        const initialState = state as Parameters<
          PaliInpageProviderSys['_initializeState']
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
      'sys_notification',
      (event: any) => {
        const { method, params } = JSON.parse(event.detail);
        console.log('SysProvider: Received new message', method, params);
        switch (method) {
          case 'pali_xpubChanged':
            this._handleConnectedXpub(params);
            break;
          case 'pali_unlockStateChanged':
            console.log('SysProvider: Received event');
            this._handleUnlockStateChanged(params);
            break;
          case 'pali_blockExplorerChanged':
            this._handleActiveBlockExplorer(params);
            break;
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
  private _initializeState(initialState?: {
    blockExplorerURL: string | null;
    isUnlocked: boolean;
    xpub: string;
  }) {
    console.log('Pali SyscoinProvider: Initializing State Function');
    if (this._sysState.initialized === true) {
      throw new Error('Pali SyscoinProvider: Provider already initialized.');
    }

    if (initialState) {
      const { xpub, blockExplorerURL, isUnlocked } = initialState;

      // EIP-1193 connect
      this._handleConnectedXpub(xpub);
      this._handleActiveBlockExplorer(blockExplorerURL);
      this._handleUnlockStateChanged({ xpub, isUnlocked });
    }

    // Mark provider as initialized regardless of whether initial state was
    // retrieved.
    this._sysState.initialized = true;
    this.emit('_sysInitialized');
  }
  // private initializesysState() {
  //   //TODO: create sysInitialized event, fetch actual active blockexplorer and create state updates only for sys
  //   const blockExplorerURL = 'https://blockbook-dev.elint.services/'; //Hardcoded to mainnet just for testing porpuses
  //   this._sysState = {
  //     blockExplorerURL,
  //     initialized: true,
  //   };
  // }
  public async isUnlocked(): Promise<boolean> {
    if (!this._sysState.initialized) {
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.isUnlocked;
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
    xpub,
    isUnlocked,
  }: { isUnlocked?: boolean; xpub?: string | null } = {}) {
    if (typeof isUnlocked !== 'boolean') {
      console.error(
        'Pali: Received invalid isUnlocked parameter. Please report this bug.'
      );
      return;
    }

    if (isUnlocked !== this._sysState.isUnlocked) {
      console.log('Changing lockState', isUnlocked);
      this._sysState.isUnlocked = isUnlocked;
      console.log('Changing lockState', this._sysState.isUnlocked);
      this._handleConnectedXpub(xpub);
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
    this._sysState.xpub = xpub;
  }

  private _handleActiveBlockExplorer(blockExplorerURL: string | null) {
    this._sysState.blockExplorerURL = blockExplorerURL;
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
         * Determines if asset is a NFT on syscoin UTXO.
         *
         * @returns Promise resolving to true if asset isNFT
         */
        isNFT: (guid: number) => {
          const validated = _isNFT(guid);
          return validated;
        },
        /**
         * Get the minted tokens by the current connected Xpub on UTXO chain.
         *
         * @returns Promise send back tokens data
         */
        getUserMintedTokens: async () => {
          const account = await this.request({ method: 'wallet_getAccount' });
          if (account) {
            const { transactions } = account as any;

            const filteredTxs = transactions?.filter(
              (tx: any) => tx.tokenType === 'SPTAssetActivate'
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
                const assetInfo = await getAsset(
                  this._sysState.blockExplorerURL,
                  t.token
                );
                const formattedAssetInfo = {
                  ...assetInfo,
                  symbol: Buffer.from(
                    String(assetInfo.symbol),
                    'base64'
                  ).toString('utf-8'),
                };
                if (formattedAssetInfo.assetGuid) return formattedAssetInfo;
              })
            );

            return txs.filter((item) => item !== undefined);
          }
          return [];
        },
        /**
         * Get the minted tokens by the current connected Xpub on UTXO chain.
         *
         * @returns Promise send back tokens data
         */
        getDataAsset: async (assetGuid: any) => {
          if (this._sysState) {
            //TODO: create sysInitialized event
            await new Promise<void>((resolve) => {
              this.on('_sysInitialized', () => resolve());
            });
          }
          return getAsset(this._sysState.blockExplorerURL, assetGuid);
        },
      },
      {
        get: (obj, prop, ...args) => Reflect.get(obj, prop, ...args),
      }
    );
  }
}
