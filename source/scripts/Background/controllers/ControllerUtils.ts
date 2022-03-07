import { ASSET_PRICE_API, PRICE_SYS_ID } from 'constants/index';

import store from 'state/store';
import { updateFiatPrice } from 'state/price';
import { logError } from 'source/utils';

const CoinGecko = require('coingecko-api');

export const CoinGeckoClient = new CoinGecko();

export interface IControllerUtils {
  appRoute: (newRoute?: string) => string;
  coinsAll: () => any;
  coinsFectchTickers: () => any;
  coinsFetch: () => any;
  coinsList: () => any;
  coinsMarkets: () => any;
  globalData: () => any;
  ping: () => any;
  updateFiat: (currency?: string, assetId?: string) => Promise<void>;
  updateFiatCurrencyForWallet: (chosenCurrency: string) => any;
  updateFiatTest: (currency?: string, asset?: string) => string;
}

const ControllerUtils = (): IControllerUtils => {
  let route = '/';

  const ping = async () => {
    const data = await CoinGeckoClient.ping();

    return data;
  };

  const globalData = async () => {
    const data = await CoinGeckoClient.global();

    return data;
  };

  const coinsAll = async () => {
    const data = await CoinGeckoClient.coins.all();

    return data;
  };

  const coinsList = async () => {
    const data = await CoinGeckoClient.coins.list();

    return data;
  };

  const coinsMarkets = async () => {
    const data = await CoinGeckoClient.coins.markets();

    return data;
  };

  const coinsFetch = async () => {
    const data = await CoinGeckoClient.coins.fetch('bitcoin', {});

    return data;
  };

  const coinsFectchTickers = async () => {
    const data = await CoinGeckoClient.coins.fetchTickers('bitcoin');

    return data;
  };

  const appRoute = (newRoute?: string) => {
    if (newRoute) {
      route = newRoute;
    }

    return route;
  };

  const updateFiatCurrencyForWallet = async (chosenCurrency = 'usd') => {
    const data = await CoinGeckoClient.simple.price({
      ids: ['syscoin'],
      vs_currencies: [chosenCurrency],
    });

    return data;
  };

  const updateFiat = async (
    currency = store.getState().price.fiat.current,
    assetId = PRICE_SYS_ID
  ) => {
    try {
      const availableCoins = await (
        await fetch(`${ASSET_PRICE_API}?currency=`)
      ).json();

      const data = await (
        await fetch(`${ASSET_PRICE_API}?currency=${currency || 'usd'}`)
      ).json();

      if (data) {
        store.dispatch(
          updateFiatPrice({
            assetId,
            price: data.rates[currency],
            availableCoins: availableCoins.rates || {
              currency: data.rates[currency],
            },
            current: currency,
          })
        );
      }
    } catch (error) {
      logError('Failed to retrieve asset price', '', error);
    }
  };

  const updateFiatTest = (currency, asset) => `${currency} ${asset}`;

  return {
    appRoute,
    updateFiat,
    updateFiatTest,
    ping,
    globalData,
    coinsAll,
    coinsList,
    coinsFetch,
    coinsMarkets,
    coinsFectchTickers,
    updateFiatCurrencyForWallet,
  };
};

export default ControllerUtils;
