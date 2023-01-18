import { isNFT as _isNFT, getAsset } from '@pollum-io/sysweb3-utils';

import { BaseProvider } from './BaseProvider';

export class PaliInpageProviderSys extends BaseProvider {
  public readonly _sys: ReturnType<PaliInpageProviderSys['_getSysAPI']>;
  private _sysState: {
    blockExplorerURL: string;
    initialized: boolean;
  };
  constructor(maxEventListeners = 100, wallet = 'pali-v2') {
    super('syscoin', maxEventListeners, wallet);
    this.initializesysState();
    this._sys = this._getSysAPI();
  }
  private initializesysState() {
    //TODO: create sysInitialized event, fetch actual active blockexplorer and create state updates only for sys
    const blockExplorerURL = 'https://blockbook.elint.services/'; //Hardcoded to mainnet just for testing porpuses
    this._sysState = {
      blockExplorerURL,
      initialized: true,
    };
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
          const tokens = await this.request({ method: 'wallet_getTokens' });
          if (tokens) {
            const { syscoin } = tokens as any;
            return syscoin?.filter(
              (token: any) => token?.type === 'SPTAssetActivate'
            );
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
