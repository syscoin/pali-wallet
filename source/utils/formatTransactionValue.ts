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
    // Clamp display precision for readability and to avoid overflow strings
    const displayCrypto = Number.isFinite(Number(ethValue))
      ? Number(ethValue).toFixed(6)
      : '0';

    const formattedFiatAmount = getFiatAmount(
      Number(fiatWithDecimals) || 0,
      2,
      String(fiatAsset).toUpperCase()
    );

    return {
      crypto: `${displayCrypto} ${nativeCurrencySymbol}`,
      formattedFiatAmount,
    };
  } catch (error) {
    // Provide consistent symbol even on error
    return { crypto: `0 ${nativeCurrencySymbol}`, formattedFiatAmount: '0' };
  }
};
