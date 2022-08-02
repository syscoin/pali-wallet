import getSymbolFromCurrency from 'currency-symbol-map';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';

export type IGetFiatAmount = (
  amount: number,
  precision?: number,
  currency?: string,
  withSymbol?: boolean
) => string;

export const usePrice = () => {
  const { fiat } = useSelector((state: RootState) => state.price);

  const getFiatAmount: IGetFiatAmount = (
    amount: number,
    precision = 4,
    currency = 'usd',
    withSymbol?: boolean
  ): string => {
    const value = amount * fiat.price;

    currency = currency.toUpperCase();

    const currencySymbol = getSymbolFromCurrency(currency);

    const formattedValue = value.toLocaleString(navigator.language, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });

    const symbol = withSymbol ? currencySymbol : '';

    return `${symbol}${formattedValue}  ${currency}`;
  };

  return { getFiatAmount };
};
