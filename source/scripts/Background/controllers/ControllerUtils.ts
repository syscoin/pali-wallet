import store from 'state/store';
import { updatePrices } from 'state/price';
import { logError } from 'utils/index';
import {
  getSearch as getCoingeckoSearch,
  INetwork,
  isValidEthereumAddress,
  isValidSYSAddress,
  getTokenJson,
  importWeb3Token,
  getAsset,
  txUtils,
  ITokenMap,
} from '@pollum-io/sysweb3-utils';
import { AxiosResponse } from 'axios';
import CoinGecko from 'coingecko-api';

export const CoinGeckoClient = new CoinGecko();

export type CoingeckoCoins = {
  contract_address?: string;
  id: string;
  large: string;
  market_cap_rank: number;
  name: string;
  symbol: string;
  thumb: string;
};

export interface EthTokenDetails {
  contract: string;
  decimals: number;
  description: string;
  id: string;
  name: string;
  symbol: string;
}

export interface IControllerUtils {
  appRoute: (newRoute?: string) => string;
  getAsset: (
    explorerUrl: string,
    assetGuid: string
  ) => Promise<{
    assetGuid: string;
    contract: string;
    decimals: number;
    maxSupply: string;
    pubData: any;
    symbol: string;
    totalSupply: string;
    updateCapabilityFlags: number;
  }>;
  getDataForToken: (tokenId: string) => any;
  getFeeRate: (fee: number) => BigInt;
  getGasUsedInTransaction: (transactionHash: string) => Promise<{
    effectiveGasPrice: number;
    gasUsed: number;
  }>;
  getPsbtFromJson: (psbt: JSON) => string;
  getRawTransaction: (explorerUrl: string, txid: string) => any;
  getSearch: (query: string) => Promise<
    AxiosResponse<
      {
        categories: any[];
        coins: CoingeckoCoins[];
        exchanges: any[];
        icos: any[];
        nfts: any[];
      },
      any
    >
  >;
  getTokenDataByContractAddress: (address: string, platform: string) => any;
  getTokenJson: () => {
    address: string;
    chainId: number;
    decimals: number;
    logoURI: string;
    name: string;
    symbol: string;
  }[];
  getTokenMap: ({
    guid,
    changeAddress,
    amount,
    receivingAddress,
  }: {
    amount: number;
    changeAddress: string;
    guid: number | string;
    receivingAddress: string;
  }) => ITokenMap;
  importToken: (contractAddress: string) => Promise<EthTokenDetails>;
  isValidEthereumAddress: (value: string, activeNetwork: INetwork) => boolean;
  isValidSYSAddress: (
    address: string,
    activeNetwork: INetwork,
    verification?: boolean
  ) => boolean;
  updateFiat: (currency?: string, assetId?: string) => Promise<void>;
  updateFiatCurrencyForWallet: ({
    base,
    currency,
  }: {
    base: string;
    currency: string;
  }) => any;
}

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
