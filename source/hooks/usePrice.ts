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
  const fiat = useSelector((state: RootState) => state.price.fiat);

  const getFiatAmount: IGetFiatAmount = (
    amount: number,
    precision = 4,
    currency = 'usd',
    withSymbol?: boolean
  ): string => {
    const value = amount * fiat.price;

    currency = currency.toUpperCase();

    const quantityOfZerosAfterDot = -Math.floor(Math.log10(value) + 1);

    const fractionValidation =
      quantityOfZerosAfterDot !== -0 && quantityOfZerosAfterDot <= 6;

    const currencySymbol = getSymbolFromCurrency(currency);

    const formattedValue = value.toLocaleString(navigator.language, {
      minimumFractionDigits: fractionValidation
        ? quantityOfZerosAfterDot + 1
        : precision,
      maximumFractionDigits: fractionValidation
        ? quantityOfZerosAfterDot + 2
        : precision,
    });

    const symbol = withSymbol ? currencySymbol : '';

    return `${symbol}${formattedValue}  ${currency}`;
  };

  return { getFiatAmount };
};
