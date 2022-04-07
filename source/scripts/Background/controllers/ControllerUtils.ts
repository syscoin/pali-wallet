import { ASSET_PRICE_API, PRICE_SYS_ID } from 'constants/index';

import store from 'state/store';
import { updateFiatPrice } from 'state/price';
import { logError } from 'utils/index';
import { getSearch as getCoingeckoSearch } from '@pollum-io/sysweb3-utils';
import { AxiosResponse } from 'axios';

const CoinGecko = require('coingecko-api');

export const CoinGeckoClient = new CoinGecko();

export type CoingeckoCoins = {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number;
  thumb: string;
  large: string;
};

export interface IControllerUtils {
  appRoute: (newRoute?: string) => string;
  updateFiat: (currency?: string, assetId?: string) => Promise<void>;
  updateFiatCurrencyForWallet: (chosenCurrency: string) => any;
  getSearch: (
    query: string
  ) => Promise<
    AxiosResponse<
      {
        nfts: any[];
        categories: any[];
        icos: any[];
        exchanges: any[];
        coins: CoingeckoCoins[];
      },
      any
    >
  >;
}

const ControllerUtils = (): IControllerUtils => {
  let route = '/';

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

  const getSearch = async (query: string) => {
    return await getCoingeckoSearch(query);
  };

  return {
    appRoute,
    updateFiat,
    updateFiatCurrencyForWallet,
    getSearch,
  };
};

export default ControllerUtils;
