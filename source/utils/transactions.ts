import { isInteger } from 'lodash';

import { IKeyringAccountState } from '@pollum-io/sysweb3-keyring';

export const getAssetBalance = (
  asset: any,
  activeAccount: IKeyringAccountState,
  isSyscoinChain: boolean
) => {
  if (!isSyscoinChain) {
    const value = Number(
      asset.tokenSymbol === 'ETH'
        ? activeAccount.balances.ethereum
        : asset.balance
    );

    return `${isInteger(value) ? value : value.toFixed(2)} ${
      asset.tokenSymbol
    }`;
  }

  return `${asset.balance.toFixed(8)} ${asset.symbol}`;
};
