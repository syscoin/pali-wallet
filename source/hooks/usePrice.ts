import getSymbolFromCurrency from 'currency-symbol-map';
import { useSelector } from 'react-redux';

import { getFiatValueByToken } from '@pollum-io/sysweb3-utils';

import { RootState } from 'state/store';

export const usePrice = () => {
  const { fiat } = useSelector((state: RootState) => state.price);

  const { networks, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const getFiatAmount = async (
    amount: number,
    precision = 4,
    currency = 'usd'
  ): Promise<string> => {
    const chain = networks.syscoin[activeNetwork.chainId]
      ? 'syscoin'
      : 'ethereum';

    const price = await getFiatValueByToken(chain, fiat.asset);

    const value = amount * Number(price);

    currency = currency.toUpperCase();

    const currencySymbol = getSymbolFromCurrency(currency);

    const formattedValue = value.toLocaleString(navigator.language, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });

    return `${currencySymbol || '  '}  ${formattedValue}  ${currency}`;
  };

  return { getFiatAmount };
};
