// formatTransactionValue - chain details should be passed from the frontend
import { formatEther } from '@ethersproject/units';

import { IGetFiatAmount } from 'hooks/index';

import { formatWithDecimals } from './format';

export const formatTransactionValue = (
  transactionValue: string,
  nativeCurrencySymbol: string,
  fiatAsset: string,
  getFiatAmount: IGetFiatAmount,
  decimals?: number
): { crypto: string; formattedFiatAmount: string } => {
  try {
    const ethValue = formatEther(transactionValue);
    const fiatWithDecimals = formatWithDecimals(ethValue, decimals || 2);

    const formattedFiatAmount = getFiatAmount(
      Number(fiatWithDecimals) || 0,
      2,
      String(fiatAsset).toUpperCase()
    );

    return {
      crypto: `${ethValue} ${nativeCurrencySymbol || 'ETH'}`,
      formattedFiatAmount,
    };
  } catch (error) {
    return { crypto: '0', formattedFiatAmount: '0' };
  }
};
