import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import {
  INetworkType,
  validateEthRpc,
  validateSysRpc,
} from '@pollum-io/sysweb3-network';
import {
  getSearch,
  isValidEthereumAddress,
  isValidSYSAddress,
  getToken,
  getTokenJson,
  getTokenByContract,
  getAsset,
  txUtils,
} from '@pollum-io/sysweb3-utils';

import { ASSET_PRICE_API } from 'constants/index';
import { getController } from 'scripts/Background';
import { setPrices, setCoins } from 'state/price';
import store from 'state/store';
import { setCoinsList } from 'state/vault';
import { IControllerUtils } from 'types/controllers';
import { getNetworkChain, logError } from 'utils/index';

import { ensureTrailingSlash } from './assets/utils';

const COINS_LIST_CACHE_KEY = 'pali_coinsListCache';
const COINS_LIST_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

const ControllerUtils = (): IControllerUtils => {
  const setFiat = async (currency?: string) => {
    if (!currency) {
      const storeCurrency = store.getState().price.fiat.asset;
      currency = storeCurrency || 'usd';
    }
    const controller = getController();
    const { isInCooldown }: CustomJsonRpcProvider =
      controller.wallet.ethereumTransaction.web3Provider;
    const { activeNetwork, isBitcoinBased } = store.getState().vault;

    const id = getNetworkChain(isBitcoinBased);

    let coinsList = null;
    try {
      const cachedData = await new Promise((resolve) => {
        chrome.storage.local.get(COINS_LIST_CACHE_KEY, (result) =>
          resolve(result[COINS_LIST_CACHE_KEY])
        );
      });

      if (
        cachedData &&
        (cachedData as any).timestamp &&
        Date.now() - (cachedData as any).timestamp < COINS_LIST_CACHE_DURATION
      ) {
        coinsList = (cachedData as any).list;
        console.log('Using cached coinsList');
      } else {
        console.log('Fetching new coinsList from CoinGecko');
        const response = await fetch(
          'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
        );
        if (!response.ok) {
          throw new Error(
            `CoinGecko API request failed with status ${response.status}`
          );
        }
        coinsList = await response.json();
        if (coinsList && Array.isArray(coinsList)) {
          // Basic validation of fetched list
          chrome.storage.local.set({
            [COINS_LIST_CACHE_KEY]: { list: coinsList, timestamp: Date.now() },
          });
          store.dispatch(setCoinsList(coinsList)); // Update Redux state only when fetched
        } else {
          coinsList = null; // Ensure coinsList is null if fetch or parse fails
          console.error('Fetched coinsList is not in expected format');
        }
      }
    } catch (fetchError) {
      console.error('Failed to fetch or cache coinsList:', fetchError);
      // Attempt to use potentially stale list from Redux store if fetch fails
      const coinsListState = store.getState().vault.coinsList;
      if (coinsListState?.length > 0) {
        coinsList = coinsListState;
        console.log(
          'Using potentially stale coinsList from Redux store after fetch failure'
        );
      }
    }

    // Ensure coinsList from Redux is updated if it was fetched successfully (already done above)
    // Or ensure we are using the one from store if cache/fetch failed but store had one.
    if (!coinsList) {
      coinsList = store.getState().vault.coinsList;
      if (!coinsList || coinsList.length === 0) {
        logError('setFiat: coinsList is empty and could not be fetched.', '');
        // Still attempt to set prices to 0 if currency specific fetch fails later
      }
    }

    switch (id) {
      case INetworkType.Syscoin:
        try {
          const activeNetworkURL = ensureTrailingSlash(activeNetwork.url);
          const { chain } = await validateSysRpc(activeNetworkURL);
          if (chain !== 'test') {
            const currencies = await (
              await fetch(`${activeNetworkURL}${ASSET_PRICE_API}`)
            ).json();
            if (currencies && currencies.rates) {
              store.dispatch(setCoins(currencies.rates));
              if (currencies.rates[currency.toLowerCase()]) {
                store.dispatch(
                  setPrices({
                    asset: currency,
                    price: currencies.rates[currency.toLowerCase()],
                  })
                );
                return;
              }
            }
          }

          store.dispatch(
            setPrices({
              asset: currency,
              price: 0,
            })
          );
        } catch (error) {
          logError('Failed to retrieve asset price - SYSCOIN UTXO', '', error);
          store.dispatch(setPrices({ asset: currency, price: 0 })); // Set price to 0 on error
        }
        break;

      case INetworkType.Ethereum:
        try {
          const { chain, chainId } = await validateEthRpc(
            activeNetwork.url,
            isInCooldown
          );

          const ethTestnetsChainsIds = [5700, 11155111, 421611, 5, 69];

          if (
            Boolean(
              chain === 'testnet' ||
                ethTestnetsChainsIds.some(
                  (validationChain) => validationChain === chainId
                )
            )
          ) {
            store.dispatch(
              setPrices({
                asset: currency,
                price: 0,
              })
            );
            return;
          }

          // Only proceed if coinsList is available
          if (coinsList && Array.isArray(coinsList) && coinsList.length > 0) {
            const findCoinSymbolByNetwork = coinsList.find(
              (coin: any) => coin.symbol === activeNetwork.currency // Added type any for coin temporarily
            )?.id;

            if (findCoinSymbolByNetwork) {
              const coinPriceResponse = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=${findCoinSymbolByNetwork}&vs_currencies=${currency}`
              );
              const coinPriceData = await coinPriceResponse.json();
              const currentNetworkCoinMarket =
                coinPriceData[findCoinSymbolByNetwork]?.[
                  currency.toLowerCase()
                ];

              store.dispatch(
                setPrices({
                  asset: currency,
                  price: currentNetworkCoinMarket
                    ? currentNetworkCoinMarket
                    : 0,
                })
              );
            } else {
              logError(
                `Could not find ID for currency symbol: ${activeNetwork.currency} in CoinGecko list`,
                ''
              );
              store.dispatch(setPrices({ asset: currency, price: 0 }));
            }
          } else {
            // If coinsList is not available, try to use potentially stale prices or default to 0
            logError(
              'setFiat EVM: coinsList not available, attempting to use stale price or default to 0.',
              ''
            );
            const lastCoinsPrices = store.getState().price.coins;
            const findLastCurrencyValue =
              lastCoinsPrices[currency.toLowerCase()];
            store.dispatch(
              setPrices({
                asset: currency,
                price:
                  findLastCurrencyValue !== undefined
                    ? findLastCurrencyValue
                    : 0,
              })
            );
          }
          return;
        } catch (error) {
          logError('Failed to retrieve asset price - EVM', '', error);
          store.dispatch(setPrices({ asset: currency, price: 0 })); // Set price to 0 on error
        }
        break;
    }
  };

  const txs = txUtils();

  return {
    setFiat,
    getSearch,
    getAsset,
    isValidEthereumAddress,
    isValidSYSAddress,
    getTokenJson,
    getToken,
    getTokenByContract,
    ...txs,
  };
};

export default ControllerUtils;
