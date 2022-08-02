import {
  getSearch,
  isValidEthereumAddress,
  isValidSYSAddress,
  getToken,
  getTokenJson,
  getTokenByContract,
  getAsset,
  txUtils,
  getFiatValueByToken,
} from '@pollum-io/sysweb3-utils';

import { ASSET_PRICE_API } from 'constants/index';
import { setPrices, setCoins } from 'state/price';
import store from 'state/store';
import { IControllerUtils } from 'types/controllers';
import { logError } from 'utils/index';

const ControllerUtils = (): IControllerUtils => {
  let route = '/';

  const appRoute = (newRoute?: string) => {
    if (newRoute) {
      route = newRoute;
    }

    return route;
  };

  const setFiat = async (currency?: string) => {
    if (!currency) {
      const storeCurrency = store.getState().price.fiat.asset;
      currency = storeCurrency || 'usd';
    }

    try {
      const { activeNetwork, networks } = store.getState().vault;

      const chain =
        networks.syscoin[activeNetwork.chainId] &&
        activeNetwork.url.includes('blockbook')
          ? 'syscoin'
          : 'ethereum';

      const price = await getFiatValueByToken(chain, currency);

      const currencies = await (
        await fetch(`${ASSET_PRICE_API}/currency`)
      ).json();

      if (currencies && currencies.rates) {
        store.dispatch(setCoins(currencies.rates));
      }

      store.dispatch(
        setPrices({
          asset: currency,
          price,
        })
      );
    } catch (error) {
      logError('Failed to retrieve asset price', '', error);
    }
  };

  const txs = txUtils();

  return {
    appRoute,
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
