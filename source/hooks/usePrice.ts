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
    currency = 'usd',
    withCurrency = true,
    withSymbol?: boolean
  ): string => {
    const value = amount * fiat.price;

    currency = currency.toUpperCase();

    const currencySymbol = getSymbolFromCurrency(currency);

    const arrayValidationSymbol = [
      withSymbol,
      currencySymbol !== undefined,
      currencySymbol !== 'undefined',
    ];

    const validateSymbol = arrayValidationSymbol.every(
      (validation) => validation === true
    );

    const symbol = validateSymbol ? currencySymbol : '';

    const formattedValue = verifyZerosInBalanceAndFormat(value, precision);

    if (formattedValue === undefined || formattedValue === 'undefined') {
      return `${symbol}0  ${currency}`;
    }
    return `${symbol} ${formattedValue}  ${withCurrency ? currency : ''}`;
  };

  return { getFiatAmount };
};
