import { ethers } from 'ethers';

import { isNFT as _isNFT, getAsset } from '@pollum-io/sysweb3-utils';

import { BaseProvider, Maybe, RequestArguments } from './BaseProvider';
import messages from './messages';
import {
  EMITTED_NOTIFICATIONS,
  isValidChainId,
  isValidNetworkVersion,
} from './utils';

// eslint-disable-next-line @typescript-eslint/naming-convention
interface SysProviderState {
  blockExplorerURL: string | null;
  initialized: boolean;
  isBitcoinBased: boolean;
  isPermanentlyDisconnected: boolean;
  isTestnet: boolean | undefined;
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
    isTestnet: false,
    isBitcoinBased: false,
  };
  private _sysState: SysProviderState;
  public readonly version: number = 2;
  public networkVersion: string | null;
  public chainId: string | null;
  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('syscoin', maxEventListeners, wallet);
    this._sys = this._getSysAPI();
    // Private state
    this._sysState = {
      ...PaliInpageProviderSys._defaultState,
    };
    this.chainId = null;
    this.networkVersion = null;
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
      'notification',
      (event: any) => {
        const { method, params } = JSON.parse(event.detail);
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
          case 'pali_isTestnet':
            this._handleIsTestnet(params);
            break;
          case 'pali_isBitcoinBased':
            this._handleIsBitcoinBased(params);
            break;
          case EMITTED_NOTIFICATIONS.includes(method):
            break;
          // EVM METHODS TO AVOID
          case 'pali_accountsChanged':
            break;
          case 'pali_chainChanged':
            this._handleChainChanged(params);
            break;
          case 'pali_removeProperty':
            break;
          case 'pali_addProperty':
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

    if (chainId !== this.chainId) {
      this.chainId = chainId;
      this.networkVersion = networkVersion;
    }
  }

  public async activeExplorer(): Promise<string> {
    if (!this._sysState.initialized) {
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.blockExplorerURL;
  }

  private _initializeState(initialState?: {
    blockExplorerURL: string | null;
    isBitcoinBased: boolean;
    isUnlocked: boolean;
    xpub: string;
  }) {
    if (this._sysState.initialized === true) {
      throw new Error('Pali SyscoinProvider: Provider already initialized.');
    }

    if (initialState) {
      const { xpub, blockExplorerURL, isUnlocked, isBitcoinBased } =
        initialState;

      // EIP-1193 connect
      this._handleConnectedXpub(xpub);
      this._handleActiveBlockExplorer(blockExplorerURL);
      this._handleUnlockStateChanged({ xpub, isUnlocked });
      this._handleIsBitcoinBased({ isBitcoinBased });
    }

    // Mark provider as initialized regardless of whether initial state was
    // retrieved.
    this._sysState.initialized = true;
    this.emit('_sysInitialized');
  }

  public async isUnlocked(): Promise<boolean> {
    if (!this._sysState.initialized) {
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.isUnlocked;
  }

  public async isTestnet(): Promise<boolean> {
    if (!this._sysState.initialized) {
      await new Promise<void>((resolve) => {
        this.on('_sysInitialized', () => resolve());
      });
    }
    return this._sysState.isTestnet;
  }

  public isBitcoinBased(): boolean {
    return this._sysState.isBitcoinBased;
  }

  // eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
  public async request<T>(args: RequestArguments): Promise<Maybe<T>> {
    if (args.method !== 'wallet_getSysProviderState') {
      const isSyscoinChain = await this._isSyscoinChain;
      if (!isSyscoinChain)
        throw new Error(
          'UTXO Content only are valid for syscoin chain for now'
        );
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
      this._sysState.isUnlocked = isUnlocked;
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
    if (!ethers.utils.isHexString(xpub) || xpub === null) {
      this._sysState.xpub = xpub;
    }
  }

  private _handleActiveBlockExplorer(blockExplorerURL: string | null) {
    this._sysState.blockExplorerURL = blockExplorerURL;
  }
  private _handleIsBitcoinBased({
    isBitcoinBased,
  }: {
    isBitcoinBased: boolean;
  }) {
    this._sysState.isBitcoinBased = isBitcoinBased;
  }
  private _handleIsTestnet({ isTestnet }: { isTestnet: boolean }) {
    this._sysState.isTestnet = isTestnet;
  }
  private async _isSyscoinChain(): Promise<boolean> {
    let checkExplorer = false;
    try {
      //Only trezor blockbooks are accepted as endpoint for UTXO chains for now
      const rpcoutput = await (
        await fetch(this._sysState.blockExplorerURL + 'api/v2')
      ).json();
      checkExplorer = rpcoutput.blockbook.coin
        .toLowerCase()
        .includes('syscoin');
    } catch (e) {
      //Its not a blockbook, so it might be a ethereum RPC
      checkExplorer = false;
    }
    return checkExplorer;
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
