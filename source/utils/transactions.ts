import { Assets } from 'types/transactions';

export const getAssetBalance = (
  selectedAsset: Assets | null,
  activeAccount
) => {
  if (selectedAsset) {
    const value = selectedAsset.balance / 10 ** selectedAsset.decimals;
    return `${value.toFixed(selectedAsset.decimals)} ${selectedAsset.symbol}`;
  }

  return `${activeAccount?.balances.syscoin.toFixed(8)} SYS`;
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
