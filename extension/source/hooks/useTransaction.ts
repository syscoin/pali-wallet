import { Assets } from 'scripts/types';
import { useAccount } from '.';

export const useTransaction = () => {
  const getAssetBalance = (selectedAsset: Assets | null) => {
    const { activeAccount } = useAccount();

    if (selectedAsset) {
      return `${(selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)} ${selectedAsset.symbol}`;
    }

    return `${activeAccount!.balance.toFixed(8)} SYS`;
  }

  const updateSendTemporaryTx = ({
    receiver,
    amount,
    fee,
    token,
    ZDAG,
    controller,
    activeAccount,
    history
  }: any) => {
    controller.wallet.account.updateTempTx({
      fromAddress: activeAccount?.address.main,
      toAddress: receiver,
      amount,
      fee,
      token: token,
      isToken: true,
      rbf: !ZDAG,
    });

    history.push('/send/confirm');
  }

  const handleCancelTransactionOnSite = (browser: any, tempTx: any) => {
    browser.runtime.sendMessage({
      type: "CANCEL_TRANSACTION",
      target: "background",
      item: tempTx ? tempTx : null
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleConfirmSendTransaction = async ({
    setLoading,
    setConfirmed,
    controller,
    activeAccount,
    formatURL,
    confirmingTransaction,
    browser,
    tempTx,
    alert
  }) => {
    const recommendedFee = await controller.wallet.account.getRecommendFee();

    if ((activeAccount ? activeAccount.balance : -1) > 0) {
      setLoading(true);

      try {
        const response = await controller.wallet.account.confirmTempTx();

        if (response) {
          alert.removeAll();
          alert.error('Can\'t complete transaction. Try again later.');

          if (confirmingTransaction) {
            browser.runtime.sendMessage({
              type: 'WALLET_ERROR',
              target: 'background',
              transactionError: true,
              invalidParams: false,
              message: `TransactionError: ${response}`
            });

            setTimeout(() => {
              handleCancelTransactionOnSite(browser, 'tempTx');
            }, 4000);
          }

          return;
        }

        browser.runtime.sendMessage({
          type: 'WALLET_ERROR',
          target: 'background',
          transactionError: false,
          invalidParams: false,
          message: 'Everything is fine, transaction completed.'
        });

        setConfirmed(true);
        setLoading(false);
      } catch (error: any) {
        console.log('error', error)

        if (activeAccount) {
          if (error && tempTx.fee > recommendedFee) {
            alert.removeAll();
            alert.error(`${formatURL(String(error.message), 166)} Please, reduce fees to send transaction.`);
          }

          if (error && tempTx.fee <= recommendedFee) {
            const max = 100 * tempTx.amount / activeAccount?.balance;

            if (tempTx.amount >= (max * tempTx.amount / 100)) {
              alert.removeAll();
              alert.error(error.message);

              setLoading(false);

              return;
            }

            alert.removeAll();
            alert.error('Can\'t complete transaction. Try again later.');
          }

          if (confirmingTransaction) {
            browser.runtime.sendMessage({
              type: 'WALLET_ERROR',
              target: 'background',
              transactionError: true,
              invalidParams: false,
              message: `TransactionError: ${error}`
            });

            setTimeout(() => {
              handleCancelTransactionOnSite(browser, tempTx);
            }, 4000);
          }

          setLoading(false);
        }
      }
    }
  };

  const handleRejectTransaction = (browser, item, history) => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: 'WALLET_ERROR',
      target: 'background',
      transactionError: true,
      invalidParams: false,
      message: "Transaction rejected.",
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
  }

  return {
    getAssetBalance,
    updateSendTemporaryTx,
    handleConfirmSendTransaction,
    handleRejectTransaction,
    handleCancelTransactionOnSite
  }
}