import { PRICE_SYS_ID } from 'constants/index';

import { useSelector } from 'react-redux';
import { RootState } from 'state/store';
import getSymbolFromCurrency from 'currency-symbol-map';
import { getFiatValueByToken } from '@pollum-io/sysweb3-utils';

export const usePrice = () => {
  const fiat = useSelector((state: RootState) => state.price.fiat);
  const network = useSelector(
    (state: RootState) => state.vault.activeNetwork.currency
  );

  const getFiatAmount = async (
    amount: number,
    precision = 4,
    currency = 'usd',
    token?: any
  ): Promise<string> => {
    const { price } = await getFiatValueByToken(token, fiat.current);

    const fiatToUse = network === 'sys' ? fiat[PRICE_SYS_ID] : price;

    const value = amount * fiatToUse;

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
