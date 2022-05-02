import store from 'state/store';
import { updatePrices } from 'state/price';
import { logError } from 'utils/index';
import {
  getSearch as getCoingeckoSearch,
  isValidEthereumAddress,
  isValidSYSAddress,
  getTokenJson,
  importWeb3Token,
  getAsset,
  txUtils,
} from '@pollum-io/sysweb3-utils';
import CoinGecko from 'coingecko-api';
import { IControllerUtils } from 'types/controllers';

export const CoinGeckoClient = new CoinGecko();

const ControllerUtils = (): IControllerUtils => {
  let route = '/';

  const appRoute = (newRoute?: string) => {
    if (newRoute) {
      route = newRoute;
    }

    return route;
  };

  // const getCoinsList = async () => {
  //   const response = await CoinGeckoClient.coins.list();

  //   return response;
  // };

  const updateFiatCurrencyForWallet = async ({ base, currency }) => {
    const data = await CoinGeckoClient.simple.price({
      ids: [base],
      vs_currencies: [currency],
    });

    return data;
  };

  // updates fiat price for the current chain
  const updateFiat = async (currency = 'usd') => {
    try {
      const { activeNetwork, networks } = store.getState().vault;

      const chain = networks.syscoin[activeNetwork.chainId]
        ? 'syscoin'
        : 'ethereum';

      const { success, data } = await updateFiatCurrencyForWallet({
        base: chain,
        currency,
      });

      // todo: get list for coins and conversion page

      if (success && data) {
        store.dispatch(
          updatePrices({
            fiat: {
              asset: currency,
              price: data[chain][currency],
            },
          })
        );
      }
    } catch (error) {
      logError('Failed to retrieve asset price', '', error);
    }
  };

  const importToken = async (contractAddress: string) =>
    await importWeb3Token(contractAddress);

  const getSearch = async (query: string): Promise<any> =>
    getCoingeckoSearch(query);

  const getDataForToken = async (tokenId: string) => {
    const response = await CoinGeckoClient.coins.fetch(tokenId);

    return response;
  };

  const getTokenDataByContractAddress = async (
    address: string,
    platform: string
  ) => {
    const { data, success } = await CoinGeckoClient.coins.fetchCoinContractInfo(
      address,
      platform
    );

    if (!success || data.error) return new Error(data.error);

    return {
      data,
      success,
    };
  };

  const txs = txUtils();

  return {
    appRoute,
    updateFiat,
    updateFiatCurrencyForWallet,
    importToken,
    getSearch,
    getAsset,
    isValidEthereumAddress,
    isValidSYSAddress,
    getTokenJson,
    getDataForToken,
    getTokenDataByContractAddress,
    ...txs,
  };
};

export default ControllerUtils;
