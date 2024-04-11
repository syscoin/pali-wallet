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
    const coinsListState = store.getState().vault.coinsList;
    const isUpToDateCoinArray =
      coinsListState?.some((item) => item?.platforms !== undefined) &&
      coinsListState?.length > 0;

    const coinsList = isUpToDateCoinArray
      ? coinsListState
      : await (
          await fetch(
            'https://api.coingecko.com/api/v3/coins/list?include_platform=true'
          )
        ).json();

    store.dispatch(setCoinsList(coinsList));

    switch (id) {
      case INetworkType.Syscoin:
        try {
          const { chain } = await validateSysRpc(activeNetwork.url);
          if (chain !== 'test') {
            //TODO: add check to verify if the active network has a / by the end of the url
            const currencies = await (
              await fetch(`${activeNetwork.url}${ASSET_PRICE_API}`)
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
        }
        break;

      case INetworkType.Ethereum:
        try {
          const { chain, chainId } = await validateEthRpc(
            activeNetwork.url,
            isInCooldown
          );

          const ethTestnetsChainsIds = [5700, 80001, 11155111, 421611, 5, 69]; // Some ChainIds from Ethereum Testnets as Polygon Testnet, Goerli, Sepolia, etc.

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

          if (coinsList?.length > 0) {
            const findCoinSymbolByNetwork = coinsList.find(
              (coin) => coin.symbol === activeNetwork.currency
            )?.id;

            const coinPriceResponse = await fetch(
              `https://api.coingecko.com/api/v3/simple/price?ids=${findCoinSymbolByNetwork}&vs_currencies=${currency}`
            );

            const coinPriceData = await coinPriceResponse.json();

            const currentNetworkCoinMarket =
              coinPriceData[findCoinSymbolByNetwork]?.[currency];

            store.dispatch(
              setPrices({
                asset: currency,
                price: currentNetworkCoinMarket ? currentNetworkCoinMarket : 0,
              })
            );

            return;
          }

          const lastCoinsPrices = store.getState().price.coins;

          const findLastCurrencyValue = lastCoinsPrices[currency];

          store.dispatch(
            setPrices({
              asset: currency,
              price: findLastCurrencyValue,
            })
          );

          return;
        } catch (error) {
          logError('Failed to retrieve asset price - EVM', '', error);
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
