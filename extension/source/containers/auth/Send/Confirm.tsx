import React, { useState } from 'react';
import { AuthViewLayout } from 'containers/common/Layout';
import { SecondaryButton, Modal } from 'components/index';;
import { useController, useStore, useUtils, useFormat, useAccount, useBrowser, useTransaction } from 'hooks/index';

export const SendConfirm = () => {
  const controller = useController();
  const { activeAccount } = useAccount();
  const { alert } = useUtils();
  const { confirmingTransaction } = useStore();
  const { browser } = useBrowser();
  const { handleCancelTransactionOnSite } = useTransaction();

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);

  const { history } = useUtils();
  const { ellipsis, formatURL } = useFormat();

  const tempTx = controller.wallet.account.getTemporaryTransaction('sendAsset');

  const handleConfirm = async () => {
    const recommendedFee = await controller.wallet.account.getRecommendFee();

    if ((activeAccount ? activeAccount.balance : -1) > 0) {
      setLoading(true);

      try {
        const callback = controller.wallet.account.confirmSendAssetTransaction;

        console.log('item asset send', tempTx)

        const response = await controller.wallet.account.confirmTemporaryTransaction({
          type: 'sendAsset',
          callback,
        });

        console.log(response)

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
  }

  return (
    <AuthViewLayout title="SEND SYS">
      {confirmed && (
        <Modal
          type="default"
          title="Transaction successful"
          description="Your transaction has been successfully submitted. You can see more details under activity on your home page."
          open={confirmed}
          onClose={() => history.push('/home')}
          doNothing
        />
      )}

      {tempTx && (
        <div className="mt-4 flex justify-center items-center flex-col w-full">
          <p className="flex flex-col justify-center text-center items-center font-rubik">
            <span className="text-brand-royalblue font-thin font-poppins">
              Send
            </span>

            {tempTx.amount} {tempTx.token ? tempTx.token.symbol : 'SYS'}
          </p >

          <div className="w-full flex justify-center divide-y divide-dashed divide-bkg-3 items-start flex-col gap-3 py-2 px-4 text-sm mt-4 text-left">
            <p className="text-brand-royalblue font-thin font-poppins flex flex-col w-full pt-2">
              From

              <span className="text-brand-white">{ellipsis(tempTx.fromAddress, 7, 15)}</span>
            </p>

            <p className="text-brand-royalblue font-thin font-poppins flex flex-col w-full pt-2">
              To

              <span className="text-brand-white">{ellipsis(tempTx.toAddress, 7, 15)}</span>
            </p>

            <p className="text-brand-royalblue font-thin font-poppins flex flex-col w-full pt-2">
              Fee

              <span className="text-brand-white">{tempTx.fee}</span>
            </p>

            <p className="text-brand-royalblue font-thin font-poppins flex flex-col w-full pt-2">
              Max total

              <span className="text-brand-white">{Number(tempTx.fee) + Number(tempTx.amount)} SYS</span>
            </p>
          </div>

          <div className="absolute bottom-12">
            <SecondaryButton
              loading={loading}
              onClick={handleConfirm}
              type="button"
            >
              Confirm
            </SecondaryButton>
          </div>
        </div>
      )}
    </AuthViewLayout >
  )
};
