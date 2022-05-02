import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import getSymbolFromCurrency from 'currency-symbol-map';
import { getFiatValueByToken } from '@pollum-io/sysweb3-utils';

export const usePrice = () => {
  const { fiat } = useSelector((state: RootState) => state.price);

  const { networks, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );

  const getFiatAmount = async (
    amount: number,
    token: string,
    precision = 4,
    currency = 'usd'
  ): Promise<string> => {
    const isSyscoinNetwork = Boolean(networks.syscoin[activeNetwork.chainId]);

    const fiatToUse =
      isSyscoinNetwork && !token
        ? fiat.price
        : await getFiatValueByToken(token, fiat.asset);

    const value = amount * Number(fiatToUse);

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
