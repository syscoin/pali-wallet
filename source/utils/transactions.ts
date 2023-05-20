import { isInteger, omit } from 'lodash';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

import { ITransactionParams, ITxState } from 'types/transactions';

import { formatCurrency, truncate } from './format';

export const getAssetBalance = (
  asset: any,
  activeAccount: IKeyringAccountState,
  isBitcoinBased: boolean
) => {
  if (!isBitcoinBased) {
    const value = Number(
      asset.tokenSymbol === 'ETH'
        ? activeAccount.balances.ethereum
        : asset.balance
    );

    return `${isInteger(value) ? value : value.toFixed(2)} ${
      asset.tokenSymbol
    }`;
  }

  const formattedBalance = truncate(
    formatCurrency(
      String(+asset.balance / 10 ** asset.decimals),
      asset.decimals
    ),
    14
  );

  return `${formattedBalance} ${asset.symbol}`;
};

export const omitTransactionObjectData = (
  transaction: ITxState | ITransactionParams,
  omitArray: Array<string>
) => omit(transaction, omitArray);
