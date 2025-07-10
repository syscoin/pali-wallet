import getSymbolFromCurrency from 'currency-symbol-map';
import { useSelector } from 'react-redux';

import { RootState } from 'state/store';
import { verifyZerosInBalanceAndFormat } from 'utils/verifyZerosInValueAndFormat';

export type IGetFiatAmount = (
  amount: number,
  precision?: number,
  currency?: string,
  withCurrency?: boolean,
  withSymbol?: boolean
) => string;

export const usePrice = () => {
  const fiat = useSelector((state: RootState) => state.price.fiat);

  const getFiatAmount: IGetFiatAmount = (
    amount: number,
    precision = 4,
    currency = fiat.asset || 'usd',
    withCurrency = true,
    withSymbol?: boolean
  ): string => {
    const value = amount * fiat.price;

    currency = currency.toUpperCase();

    const currencySymbol = getSymbolFromCurrency(currency);

    const arrayValidationSymbol = [
      withSymbol === true,
      currencySymbol !== undefined,
      currencySymbol !== 'undefined',
    ];

    const validateSymbol = arrayValidationSymbol.every(
      (validation) => validation === true
    );

    const symbol = validateSymbol ? currencySymbol : '';

    if (!fiat.price || fiat.price === 0 || value === 0 || !value) {
      return `${symbol}0 ${withCurrency ? currency : ''}`;
    }

    const formattedValue = verifyZerosInBalanceAndFormat(value, precision);

    if (formattedValue === undefined || formattedValue === 'undefined') {
      return `${symbol}0 ${withCurrency ? currency : ''}`;
    }
    return `${symbol}${formattedValue} ${withCurrency ? currency : ''}`;
  };

  return { getFiatAmount };
};
