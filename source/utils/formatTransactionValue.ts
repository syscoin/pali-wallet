import { chains } from 'eth-chains';
import { ethers } from 'ethers';

import { IGetFiatAmount } from 'hooks/index';

import { formatWithDecimals } from './format';

export const formatTransactionValue = (
  transactionValue: string,
  chainId: number,
  fiatAsset: string,
  getFiatAmount: IGetFiatAmount,
  decimals?: number
): { crypto: string; formattedFiatAmount: string } => {
  try {
    const { nativeCurrency } = chains.getById(chainId);

    const ethValue = ethers.utils.formatEther(transactionValue);
    const fiatWithDecimals = formatWithDecimals(ethValue, decimals || 2);

    const formattedFiatAmount = getFiatAmount(
      Number(fiatWithDecimals) || 0,
      2,
      String(fiatAsset).toUpperCase()
    );

    return {
      crypto: `${ethValue} ${nativeCurrency.symbol}`,
      formattedFiatAmount,
    };
  } catch (error) {
    return { crypto: '0', formattedFiatAmount: '0' };
  }
};
