import { Assets } from 'types/transactions';
import { useStore } from 'hooks/index';

export const useTransaction = () => {
  const { activeNetworkType } = useStore();
  const getAssetBalance = (selectedAsset: Assets | null, activeAccount) => {
    if (selectedAsset) {
      return `${(selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(
        selectedAsset.decimals
      )} ${selectedAsset.symbol}`;
    }

    return `${activeAccount?.balance.toFixed(8)} ${
      activeNetworkType === 'syscoin' ? 'SYS' : 'ETH'
    }`;
  };

  const handleCancelTransactionOnSite = (browser: any, tempTx: any) => {
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

  const handleRejectTransaction = (browser, item, navigate) => {
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
      item: item || null,
    });

    browser.runtime.sendMessage({
      type: 'CLOSE_POPUP',
      target: 'background',
    });
  };

  return {
    getAssetBalance,
    handleRejectTransaction,
    handleCancelTransactionOnSite,
  };
};
