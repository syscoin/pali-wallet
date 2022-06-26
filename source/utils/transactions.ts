import { IAssets } from 'types/transactions';

export const getAssetBalance = (
  selectedAsset: IAssets | null,
  activeAccount
) => {
  if (selectedAsset) {
    const value = Number(
      selectedAsset.symbol === 'ETH'
        ? activeAccount.balances.ethereum
        : selectedAsset.balance
    );

    return `${value.toFixed(8)} ${selectedAsset.symbol}`;
  }

  return `${activeAccount?.balance.toFixed(8)} SYS`;
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
