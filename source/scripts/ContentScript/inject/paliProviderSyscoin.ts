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
    const blockExplorerURL = 'https://blockbook-dev.elint.services/'; //Hardcoded to mainnet just for testing porpuses
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
          const account = await this.request({ method: 'wallet_getAccount' });
          if (account) {
            const { transactions } = account as any;

            const txs = await Promise.all(
              transactions
                ?.filter((tx: any) => tx.tokenType === 'SPTAssetActivate')
                ?.map(async (tx: any) => {
                  const assetInfo = await getAsset(
                    this._sysState.blockExplorerURL,
                    tx.tokenTransfers[0].token
                  );
                  if (assetInfo.assetGuid) return assetInfo;
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
