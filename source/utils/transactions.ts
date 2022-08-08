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

export const cancelTransaction = (browser: any, tempTx: any) => {
  browser.runtime.sendMessage({
    type: 'CANCEL_TRANSACTION',
    target: 'background',
    item: tempTx || null,
  });

  browser.runtime.sendMessage({
    type: 'CLOSE_POPUP',
    target: 'background',
  });
};

export const rejectTransaction = (browser, item, navigate) => {
  navigate('/home');

  browser.runtime.sendMessage({
    type: 'WALLET_ERROR',
    target: 'background',
    transactionError: true,
    invalidParams: false,
    message: 'Transaction rejected.',
  });

  browser.runtime.sendMessage({
    type: 'CANCEL_TRANSACTION',
    target: 'background',
    item,
  });

  browser.runtime.sendMessage({
    type: 'CLOSE_POPUP',
    target: 'background',
  });
};
