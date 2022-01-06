import { PRICE_SYS_ID } from 'constants/index';

import { useSelector } from 'react-redux';
import IPriceState from 'state/price/types';
import { RootState } from 'state/store';
import getSymbolFromCurrency from 'currency-symbol-map'

export const usePrice = () => {
  const price: IPriceState = useSelector((state: RootState) => state.price);

  return (amount: number, fraction = 4, selectedCoin = 'usd') => {
    const value = amount * price.fiat[PRICE_SYS_ID];

    return `${getSymbolFromCurrency(selectedCoin.toUpperCase()) ? getSymbolFromCurrency(selectedCoin.toUpperCase()) : '  '}  ${value.toLocaleString(
      navigator.language,
      {
        minimumFractionDigits: fraction,
        maximumFractionDigits: fraction,
      }
    )}  ${selectedCoin.toUpperCase()}`;
  };
}
