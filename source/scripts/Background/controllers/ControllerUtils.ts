import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';
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
  let externalRoute = '/';

  const appRoute = (newRoute?: string, external = false) => {
    if (newRoute) {
      if (external) externalRoute = newRoute;
      else route = newRoute;
    }

    return external ? externalRoute : route;
  };

  const setFiat = async (currency?: string) => {
    if (!currency) {
      const storeCurrency = store.getState().price.fiat.asset;
      currency = storeCurrency || 'usd';
    }

    try {
      const { activeNetwork, isBitcoinBased } = store.getState().vault;

      const id = isBitcoinBased ? 'syscoin' : 'ethereum';

      if (id === 'ethereum') {
        const { chain } = await validateEthRpc(activeNetwork.url);

        if (chain === 'testnet') {
          store.dispatch(
            setPrices({
              asset: currency,
              price: 0,
            })
          );

          return;
        }

        const coins = await (
          await fetch(
            `https://api.coingecko.com/api/v3/coins/markets?vs_currency=${currency}&order=market_cap_desc&per_page=100&page=1&sparkline=false`
          )
        ).json();

        const currentNetworkCoinMarket = coins.find(
          (coin) => coin.symbol === activeNetwork.currency
        );

        store.dispatch(
          setPrices({
            asset: currency,
            price: currentNetworkCoinMarket
              ? currentNetworkCoinMarket.current_price
              : 0,
          })
        );

        return;
      }

      const { chain } = await validateSysRpc(activeNetwork.url);

      const price =
        chain === 'test' ? 0 : await getFiatValueByToken(id, currency);

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
