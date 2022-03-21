import { PRICE_SYS_ID } from 'constants/index';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import getSymbolFromCurrency from 'currency-symbol-map';

export const usePrice = () => {
  const fiat = useSelector((state: RootState) => state.price.fiat);

  const getFiatAmount = (
    amount: number,
    precision = 4,
    currency = 'usd'
  ): string => {
    const value = amount * fiat[PRICE_SYS_ID];

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
